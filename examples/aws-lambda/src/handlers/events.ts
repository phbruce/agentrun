// SPDX-License-Identifier: AGPL-3.0-only

// API Gateway handler: receives Slack Events API webhooks and interaction payloads.
// Handles URL verification, deduplicates events (DynamoDB conditional write),
// and dispatches queries to SQS for async processing by the process handler.

import type { APIGatewayProxyEvent, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { addReaction } from "@agentrun-oss/channel-slack";
import { bootstrapPlatform } from "@agentrun-oss/core";
import "../setup.js";

// ── Cold-start initialization ───────────────────────────────────────────────

const _bootstrap = bootstrapPlatform().catch((err) =>
    console.error("Platform bootstrap failed:", err.message),
);

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });
const sqs = new SQSClient({ region: process.env.AWS_REGION });

const DEDUP_TABLE = process.env.AGENTRUN_DEDUP_TABLE ?? "agentrun-dedup";
const DEDUP_TTL_SECONDS = 5 * 60;
const PROCESS_QUEUE_URL = process.env.AGENTRUN_PROCESS_QUEUE_URL ?? "";

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

function jsonResponse(statusCode: number, body: any): APIGatewayProxyStructuredResultV2 {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

async function isDuplicate(eventId: string): Promise<boolean> {
    const ttl = Math.floor(Date.now() / 1000) + DEDUP_TTL_SECONDS;
    try {
        await dynamo.send(new PutItemCommand({
            TableName: DEDUP_TABLE,
            Item: {
                eventId: { S: eventId },
                ttl: { N: String(ttl) },
            },
            ConditionExpression: "attribute_not_exists(eventId)",
        }));
        return false;
    } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return true;
        throw e;
    }
}

async function dispatchToSqs(payload: Record<string, any>): Promise<void> {
    await sqs.send(new SendMessageCommand({
        QueueUrl: PROCESS_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
    }));
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

    if (action.action_id.startsWith("skill_") && action.value) {
        return action.value;
    }

    if (action.action_id.startsWith("uc_select_") && action.selected_option) {
        if (action.selected_option.text?.text) {
            return action.selected_option.text.text;
        }
        return action.selected_option.value.replace(/^wf:/, "").replace(/-/g, " ");
    }

    return null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyStructuredResultV2> {
    try {
        await _bootstrap;
        const rawBody = event.body || "";

        // ── Slack Interactions (block_actions from buttons/dropdowns) ──
        if (rawBody.startsWith("payload=")) {
            const payload = parseInteractionPayload(rawBody);
            if (!payload || payload.type !== "block_actions") {
                return jsonResponse(200, { ok: true });
            }

            const text = extractActionText(payload);
            if (!text) return jsonResponse(200, { ok: true });

            const userId = payload.user.id;
            const channelId = payload.channel?.id || payload.container?.channel_id || "";
            const messageTs = payload.message?.ts || payload.container?.message_ts || "";
            const threadTs = payload.message?.thread_ts || payload.container?.thread_ts || messageTs;

            await dispatchToSqs({ userId, channelId, text, responseUrl: payload.response_url, threadTs, messageTs });

            return jsonResponse(200, { ok: true });
        }

        // ── Slack Events API ──
        const body: SlackEventPayload = JSON.parse(rawBody);

        // URL verification challenge (Slack sends this during app setup)
        if (body.type === "url_verification") {
            return jsonResponse(200, { challenge: body.challenge });
        }

        if (body.type !== "event_callback" || !body.event) {
            return jsonResponse(200, { ok: true });
        }

        const slackEvent = body.event;
        const isDm = slackEvent.type === "message" && slackEvent.channel_type === "im";
        if (slackEvent.type !== "app_mention" && !isDm) {
            return jsonResponse(200, { ok: true });
        }

        // Ignore bot messages and subtypes (edits, deletes, etc.)
        if (slackEvent.bot_id || slackEvent.subtype) {
            return jsonResponse(200, { ok: true });
        }

        // Deduplicate retries from Slack
        if (body.event_id && await isDuplicate(body.event_id)) {
            return jsonResponse(200, { ok: true });
        }

        const text = slackEvent.type === "app_mention"
            ? cleanMentionText(slackEvent.text)
            : (slackEvent.text || "").trim();
        if (!text) return jsonResponse(200, { ok: true });

        const threadTs = slackEvent.thread_ts || slackEvent.ts;

        // Dispatch to SQS + add visual feedback in parallel
        await Promise.all([
            dispatchToSqs({
                userId: slackEvent.user,
                channelId: slackEvent.channel,
                text,
                threadTs,
                messageTs: slackEvent.ts,
            }),
            addReaction(slackEvent.channel, slackEvent.ts, "eyes").catch(() => {}),
        ]);

        return jsonResponse(200, { ok: true });
    } catch (e: any) {
        console.error("Events handler error:", e);
        // Slack expects 200, otherwise it retries
        return jsonResponse(200, { ok: true });
    }
}
