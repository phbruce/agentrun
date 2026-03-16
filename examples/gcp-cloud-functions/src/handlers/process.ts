// SPDX-License-Identifier: AGPL-3.0-only

// Pub/Sub-triggered Cloud Function: processes queued queries through AgentRun.
// Receives messages published by the events handler and runs the full agent loop.

import type { CloudEvent } from "@google-cloud/functions-framework";
import {
    processRequest,
    bootstrapPlatform,
    loadCatalogForPacks,
    setCatalog,
} from "@agentrun-ai/core";
import type { ChannelAdapter, ChannelContext } from "@agentrun-ai/core";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";
import { GChatChannelAdapter } from "@agentrun-ai/channel-gchat";
import "../setup.js";

// ── Cold-start initialization ───────────────────────────────────────────────

const PACKS = (process.env.AGENTRUN_PACKS ?? "default").split(",");

const _bootstrap = bootstrapPlatform()
    .then(() => {
        console.info("Cold start: loading catalog for packs...");
        return loadCatalogForPacks(PACKS);
    })
    .then((catalog) => {
        console.info(
            `Cold start: catalog loaded — tools=${catalog.tools.size} ` +
            `workflows=${catalog.workflows.size} skills=${catalog.skills.size}`,
        );
        setCatalog(catalog);
    })
    .catch((err) => {
        console.error("Platform bootstrap failed — using defaults:", err?.message);
    });

const slackAdapter = new SlackChannelAdapter();
const gchatAdapter = new GChatChannelAdapter();

// ── Pub/Sub message shape ───────────────────────────────────────────────────

interface SlackPubSubData {
    source?: "slack";
    userId: string;
    channelId: string;
    text: string;
    responseUrl?: string;
    threadTs?: string;
    messageTs?: string;
}

interface GChatPubSubData {
    source: "gchat";
    userId: string;
    text: string;
    meta: {
        spaceId: string;
        threadName: string;
        displayName: string;
    };
}

type PubSubData = SlackPubSubData | GChatPubSubData;

// ── Cloud Function entry point ──────────────────────────────────────────────

export async function processHandler(event: CloudEvent<{ message: { data: string } }>): Promise<void> {
    await _bootstrap;

    // Pub/Sub messages are base64-encoded — handle both CloudEvent formats
    console.log("Event keys:", Object.keys(event));
    console.log("Event.data type:", typeof event.data, event.data ? Object.keys(event.data) : "null");

    const messageData = (event.data as any)?.message?.data   // CloudEvents v1
        ?? (event as any).message?.data                       // Legacy
        ?? (event.data as any)?.data                          // Direct
        ?? "";

    const raw = Buffer.from(messageData, "base64").toString("utf-8");
    let body: PubSubData;
    try {
        body = JSON.parse(raw);
    } catch {
        console.error("Failed to parse Pub/Sub message. Raw:", raw.slice(0, 200));
        console.error("Full event:", JSON.stringify(event).slice(0, 500));
        return;
    }

    const requestId = event.id ?? crypto.randomUUID();
    const source = body.source ?? "slack";

    let ctx: ChannelContext;
    let adapter: ChannelAdapter;

    if (source === "gchat") {
        const gchatBody = body as GChatPubSubData;
        const { userId, text, meta } = gchatBody;
        const { spaceId, threadName, displayName } = meta ?? {};

        console.info(`Processing GChat query: user=${userId} space=${spaceId}`);

        ctx = {
            requestId,
            sessionId: threadName
                ? `gchat:${spaceId}#${threadName}`
                : `gchat:${spaceId}#${requestId}`,
            userId,
            source: "gchat",
            query: text,
            isPrivate: false,
            meta: {
                spaceId: spaceId ?? "",
                threadName: threadName ?? "",
                displayName: displayName ?? "",
            },
        };
        adapter = gchatAdapter;
    } else {
        const slackBody = body as SlackPubSubData;
        const { userId, channelId, text, responseUrl, threadTs, messageTs } = slackBody;
        const isDm = channelId?.startsWith("D") ?? false;

        console.info(`Processing Slack query: user=${userId} channel=${channelId} isDm=${isDm}`);

        ctx = {
            requestId,
            sessionId: threadTs
                ? `slack:${channelId}#${threadTs}`
                : `slack:${channelId}#${messageTs}`,
            userId,
            source: "slack",
            query: text,
            isPrivate: isDm,
            responseUrl,
            meta: {
                channelId: channelId ?? "",
                threadTs: threadTs ?? "",
                messageTs: messageTs ?? "",
            },
        };
        adapter = slackAdapter;
    }

    try {
        await processRequest({ ctx, adapter });
    } catch (error: any) {
        console.error(`Process failed for event ${event.id}:`, error.message);
        // Throwing will cause Pub/Sub to retry (up to the subscription's max retry)
        throw error;
    }
}
