// SPDX-License-Identifier: AGPL-3.0-only

// HTTP Cloud Function: receives Google Chat webhook events (Workspace Add-on format).
// Parses the event, deduplicates, and publishes to Pub/Sub for async processing.

import type { Request, Response } from "@google-cloud/functions-framework";
import { PubSub } from "@google-cloud/pubsub";
import { bootstrapPlatform } from "@agentrun-ai/core";
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

interface GChatUser {
    name: string;
    displayName: string;
    type: string;
    email?: string;
}

interface GChatSpace {
    name: string;
    type: string;
    displayName?: string;
}

interface GChatThread {
    name: string;
}

interface GChatMessage {
    name: string;
    sender: GChatUser;
    text?: string;
    argumentText?: string;
    thread?: GChatThread;
    space: GChatSpace;
    createTime: string;
}

// Workspace Add-on envelope format
interface GChatAddOnPayload {
    chat?: {
        user: GChatUser;
        eventTime: string;
        messagePayload?: {
            space: GChatSpace;
            message: GChatMessage;
        };
        addedToSpacePayload?: {
            space: GChatSpace;
        };
        removedFromSpacePayload?: {
            space: GChatSpace;
        };
    };
    // Legacy format
    type?: string;
    message?: GChatMessage;
    user?: GChatUser;
    space?: GChatSpace;
}

interface ParsedEvent {
    eventType: string;
    message?: GChatMessage;
    user?: GChatUser;
    space?: GChatSpace;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseGChatEvent(body: GChatAddOnPayload): ParsedEvent {
    // Workspace Add-on format (chat.messagePayload envelope)
    if (body.chat) {
        if (body.chat.messagePayload) {
            return {
                eventType: "MESSAGE",
                message: body.chat.messagePayload.message,
                user: body.chat.user,
                space: body.chat.messagePayload.space,
            };
        }
        if (body.chat.addedToSpacePayload) {
            return {
                eventType: "ADDED_TO_SPACE",
                user: body.chat.user,
                space: body.chat.addedToSpacePayload.space,
            };
        }
        if (body.chat.removedFromSpacePayload) {
            return {
                eventType: "REMOVED_FROM_SPACE",
                user: body.chat.user,
                space: body.chat.removedFromSpacePayload.space,
            };
        }
    }
    // Legacy format
    return {
        eventType: body.type ?? "UNKNOWN",
        message: body.message,
        user: body.user,
        space: body.space,
    };
}

function isDuplicate(eventId: string): boolean {
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

// ── Cloud Function entry point ──────────────────────────────────────────────

export async function gchatEventsHandler(req: Request, res: Response): Promise<void> {
    try {
        await _bootstrap;

        const body: GChatAddOnPayload =
            typeof req.body === "object" ? req.body : JSON.parse(req.body ?? "{}");
        const parsed = parseGChatEvent(body);

        // ADDED_TO_SPACE — acknowledge silently
        if (parsed.eventType === "ADDED_TO_SPACE") {
            console.info("Bot added to space:", parsed.space?.name);
            res.status(200).json({});
            return;
        }

        // REMOVED_FROM_SPACE — acknowledge silently
        if (parsed.eventType === "REMOVED_FROM_SPACE") {
            console.info("Bot removed from space:", parsed.space?.name);
            res.status(200).json({});
            return;
        }

        // Only handle MESSAGE events
        if (parsed.eventType !== "MESSAGE" || !parsed.message || !parsed.space || !parsed.user) {
            console.info("Ignoring non-MESSAGE event:", parsed.eventType);
            res.status(200).json({});
            return;
        }

        const message = parsed.message;
        const spaceId = parsed.space.name;
        const threadName = message.thread?.name ?? "";
        const senderName = parsed.user.displayName;
        const userId = parsed.user.email || parsed.user.name;

        // Use message name as dedup key
        const eventId = `gchat:${message.name}`;
        if (isDuplicate(eventId)) {
            console.info("Duplicate GChat event, skipping:", eventId);
            res.status(200).json({});
            return;
        }

        // argumentText strips the @mention; fall back to text
        const text = (message.argumentText || message.text || "").trim();
        if (!text) {
            res.status(200).json({});
            return;
        }

        console.info(`GChat message: user=${userId} space=${spaceId} text=${text.slice(0, 80)}`);

        await publishMessage({
            source: "gchat",
            userId,
            text,
            meta: {
                spaceId,
                threadName,
                displayName: senderName,
            },
        });

        res.status(200).json({});
    } catch (e: any) {
        console.error("GChat events handler error:", e);
        res.status(200).json({});
    }
}
