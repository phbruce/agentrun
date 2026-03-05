// SPDX-License-Identifier: AGPL-3.0-only

// HTTP Cloud Function: receives Slack Events API webhooks and interaction payloads.
// Publishes query messages to Pub/Sub for async processing by the process function.

import type { Request, Response } from "@google-cloud/functions-framework";
import { PubSub } from "@google-cloud/pubsub";
import { addReaction } from "@agentrun-oss/channel-slack";
import { bootstrapPlatform } from "@agentrun-oss/core";
import "../setup.js";

// ── Cold-start initialization ───────────────────────────────────────────────

const _bootstrap = bootstrapPlatform().catch((err) =>
    console.error("Platform bootstrap failed:", err.message),
);

const pubsub = new PubSub({ projectId: process.env.GCP_PROJECT_ID });
const TOPIC_NAME = process.env.PUBSUB_TOPIC ?? "agentrun-process";

// Simple in-memory dedup (for single-instance; use Firestore/Memorystore for multi-instance)
const recentEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────────────

interface SlackEvent {
    type: string;
    subtype?: string;
    user: string;
    text: string;
    channel: string;
    channel_type?: string;
    ts: string;
    thread_ts?: string;
    event_ts: string;
    bot_id?: string;
}

interface SlackEventPayload {
    type: string;
    challenge?: string;
    event?: SlackEvent;
    event_id?: string;
}

interface SlackInteractionPayload {
    type: string;
    user: { id: string };
    channel?: { id: string };
    message?: { ts: string; thread_ts?: string };
    actions?: Array<{
        action_id: string;
        type: string;
        value?: string;
        selected_option?: { value: string; text?: { text: string } };
    }>;
    response_url?: string;
    container?: { message_ts: string; channel_id: string; thread_ts?: string };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isDuplicate(eventId: string): boolean {
    // Cleanup expired entries
    const now = Date.now();
    for (const [key, ts] of recentEvents) {
        if (now - ts > DEDUP_TTL_MS) recentEvents.delete(key);
    }
    if (recentEvents.has(eventId)) return true;
    recentEvents.set(eventId, now);
    return false;
}

async function publishMessage(data: Record<string, any>): Promise<void> {
    const topic = pubsub.topic(TOPIC_NAME);
    await topic.publishMessage({ json: data });
}

function cleanMentionText(text: string): string {
    return text.replace(/<@[^>]+>\s*/g, "").trim();
}

function parseInteractionPayload(rawBody: string): SlackInteractionPayload | null {
    try {
        const decoded = decodeURIComponent(rawBody.replace(/^payload=/, "").replace(/\+/g, " "));
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

function extractActionText(payload: SlackInteractionPayload): string | null {
    const action = payload.actions?.[0];
    if (!action) return null;
    if (action.action_id.startsWith("skill_") && action.value) return action.value;
    if (action.action_id.startsWith("uc_select_") && action.selected_option) {
        return action.selected_option.text?.text
            ?? action.selected_option.value.replace(/^wf:/, "").replace(/-/g, " ");
    }
    return null;
}

// ── Cloud Function entry point ──────────────────────────────────────────────

export async function eventsHandler(req: Request, res: Response): Promise<void> {
    try {
        await _bootstrap;
        const rawBody = req.body ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : "";

        // ── Slack Interactions ──
        if (typeof req.body === "string" && req.body.startsWith("payload=")) {
            const payload = parseInteractionPayload(req.body);
            if (!payload || payload.type !== "block_actions") {
                res.status(200).json({ ok: true });
                return;
            }
            const text = extractActionText(payload);
            if (!text) {
                res.status(200).json({ ok: true });
                return;
            }

            const userId = payload.user.id;
            const channelId = payload.channel?.id || payload.container?.channel_id || "";
            const messageTs = payload.message?.ts || payload.container?.message_ts || "";
            const threadTs = payload.message?.thread_ts || payload.container?.thread_ts || messageTs;

            await publishMessage({ userId, channelId, text, responseUrl: payload.response_url, threadTs, messageTs });
            res.status(200).json({ ok: true });
            return;
        }

        // ── Slack Events API ──
        const body: SlackEventPayload = typeof req.body === "object" ? req.body : JSON.parse(rawBody);

        if (body.type === "url_verification") {
            res.status(200).json({ challenge: body.challenge });
            return;
        }

        if (body.type !== "event_callback" || !body.event) {
            res.status(200).json({ ok: true });
            return;
        }

        const slackEvent = body.event;
        const isDm = slackEvent.type === "message" && slackEvent.channel_type === "im";
        if (slackEvent.type !== "app_mention" && !isDm) {
            res.status(200).json({ ok: true });
            return;
        }

        if (slackEvent.bot_id || slackEvent.subtype) {
            res.status(200).json({ ok: true });
            return;
        }

        if (body.event_id && isDuplicate(body.event_id)) {
            res.status(200).json({ ok: true });
            return;
        }

        const text = slackEvent.type === "app_mention"
            ? cleanMentionText(slackEvent.text)
            : (slackEvent.text || "").trim();
        if (!text) {
            res.status(200).json({ ok: true });
            return;
        }

        const threadTs = slackEvent.thread_ts || slackEvent.ts;

        await Promise.all([
            publishMessage({
                userId: slackEvent.user,
                channelId: slackEvent.channel,
                text,
                threadTs,
                messageTs: slackEvent.ts,
            }),
            addReaction(slackEvent.channel, slackEvent.ts, "eyes").catch(() => {}),
        ]);

        res.status(200).json({ ok: true });
    } catch (e: any) {
        console.error("Events handler error:", e);
        res.status(200).json({ ok: true });
    }
}
