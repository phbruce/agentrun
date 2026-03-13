// SPDX-License-Identifier: AGPL-3.0-only

// Standalone Fastify server that serves Google Chat events.
// All processing happens in-process using an async task queue.

import "dotenv/config";
import Fastify from "fastify";
import {
    processRequest,
    bootstrapPlatform,
    loadCatalogForPacks,
    setCatalog,
} from "@agentrun-ai/core";
import type { ChannelContext } from "@agentrun-ai/core";
import { GChatChannelAdapter } from "@agentrun-ai/channel-gchat";
import "./setup.js";

// ── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const PACKS = (process.env.AGENTRUN_PACKS ?? "default").split(",");

// ── Bootstrap ───────────────────────────────────────────────────────────────

const _bootstrap = bootstrapPlatform()
    .then(() => {
        console.info("Loading catalog for packs:", PACKS);
        return loadCatalogForPacks(PACKS);
    })
    .then((catalog) => {
        console.info(
            `Catalog loaded — tools=${catalog.tools.size} ` +
            `workflows=${catalog.workflows.size} skills=${catalog.skills.size}`,
        );
        setCatalog(catalog);
    })
    .catch((err) => {
        console.error("Platform bootstrap failed:", err?.message);
    });

// ── Google Chat types ───────────────────────────────────────────────────────

interface GChatUser {
    name: string;
    displayName: string;
    email: string;
}

interface GChatMessage {
    name: string;
    sender: GChatUser;
    text: string;
    thread?: { name: string };
    createTime: string;
}

interface GChatSpace {
    name: string;
    displayName: string;
    type: "DM" | "ROOM";
}

interface GChatEvent {
    type: "MESSAGE" | "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE" | "CARD_CLICKED";
    eventTime: string;
    space: GChatSpace;
    message?: GChatMessage;
    user: GChatUser;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const gchatAdapter = new GChatChannelAdapter();

// Simple in-memory dedup
const recentEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function isDuplicate(eventId: string): boolean {
    const now = Date.now();
    for (const [key, ts] of recentEvents) {
        if (now - ts > DEDUP_TTL_MS) recentEvents.delete(key);
    }
    if (recentEvents.has(eventId)) return true;
    recentEvents.set(eventId, now);
    return false;
}

function cleanMentionText(text: string): string {
    // Google Chat @mentions appear as plain text, e.g. "@BotName query"
    return text.replace(/@\S+\s*/, "").trim();
}

// Async task queue — processes queries in the background so we can respond
// to Google Chat quickly (synchronous response expected within seconds).
function enqueue(task: () => Promise<void>): void {
    task().catch((err) => console.error("Background task failed:", err.message));
}

// ── Query processing ────────────────────────────────────────────────────────

async function processQuery(params: {
    userId: string;
    spaceId: string;
    text: string;
    threadName: string;
    messageId: string;
    displayName: string;
}): Promise<void> {
    const { userId, spaceId, text, threadName, messageId, displayName } = params;
    const isDm = spaceId.includes("/dm/") || false;

    const ctx: ChannelContext = {
        requestId: crypto.randomUUID(),
        sessionId: threadName
            ? `gchat:${threadName}`
            : `gchat:${spaceId}#${messageId}`,
        userId,
        source: "gchat",
        query: text,
        isPrivate: isDm,
        meta: {
            spaceId,
            threadName: threadName ?? "",
            messageId: messageId ?? "",
            displayName: displayName ?? "",
        },
    };

    await processRequest({ ctx, adapter: gchatAdapter });
}

// ── Server ──────────────────────────────────────────────────────────────────

const app = Fastify({ logger: true });

// Health check
app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

// ── Google Chat events endpoint ──

app.post("/gchat", async (request, reply) => {
    await _bootstrap;

    const event = request.body as GChatEvent;

    // Handle bot added to space — send greeting
    if (event.type === "ADDED_TO_SPACE") {
        const spaceId = event.space.name;
        const ctx: ChannelContext = {
            requestId: crypto.randomUUID(),
            sessionId: `gchat:${spaceId}`,
            userId: event.user.email || event.user.name,
            source: "gchat",
            query: "",
            isPrivate: event.space.type === "DM",
            meta: { spaceId, threadName: "", messageId: "", displayName: event.user.displayName },
        };
        enqueue(() => gchatAdapter.deliverGreeting(ctx));
        return reply.code(200).send({});
    }

    // Handle bot removed — no-op
    if (event.type === "REMOVED_FROM_SPACE") {
        return reply.code(200).send({});
    }

    // Only process MESSAGE events with text
    if (event.type !== "MESSAGE" || !event.message?.text) {
        return reply.code(200).send({});
    }

    const msg = event.message;
    const eventId = msg.name;

    // Dedup
    if (isDuplicate(eventId)) {
        return reply.code(200).send({});
    }

    // Extract context
    const spaceId = event.space.name;
    const threadName = msg.thread?.name ?? "";
    const userId = event.user.email || event.user.name;
    const isDm = event.space.type === "DM";
    const text = isDm ? msg.text.trim() : cleanMentionText(msg.text);

    if (!text) {
        return reply.code(200).send({});
    }

    // Process in background, respond immediately to Google Chat
    enqueue(() => processQuery({
        userId,
        spaceId,
        text,
        threadName,
        messageId: eventId,
        displayName: event.user.displayName,
    }));

    // Return empty JSON — the adapter will send messages asynchronously
    // via the Google Chat API (using service account credentials).
    return reply.code(200).send({});
});

// ── Start ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
    try {
        await app.listen({ port: PORT, host: HOST });
        console.info(`AgentRun GChat server listening on ${HOST}:${PORT}`);
        console.info(`  Google Chat events: http://${HOST}:${PORT}/gchat`);
        console.info(`  Health check:       http://${HOST}:${PORT}/health`);
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
}

start();
