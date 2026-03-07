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
import type { ChannelContext } from "@agentrun-ai/core";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";
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

// ── Pub/Sub message shape ───────────────────────────────────────────────────

interface PubSubData {
    userId: string;
    channelId: string;
    text: string;
    responseUrl?: string;
    threadTs?: string;
    messageTs?: string;
}

// ── Cloud Function entry point ──────────────────────────────────────────────

export async function processHandler(event: CloudEvent<{ message: { data: string } }>): Promise<void> {
    await _bootstrap;

    // Pub/Sub messages are base64-encoded
    const raw = Buffer.from(event.data?.message?.data ?? "", "base64").toString("utf-8");
    let body: PubSubData;
    try {
        body = JSON.parse(raw);
    } catch {
        console.error("Failed to parse Pub/Sub message:", raw);
        return;
    }

    const { userId, channelId, text, responseUrl, threadTs, messageTs } = body;
    const isDm = channelId?.startsWith("D") ?? false;

    console.info(`Processing query: user=${userId} channel=${channelId} isDm=${isDm}`);

    const ctx: ChannelContext = {
        requestId: event.id ?? crypto.randomUUID(),
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

    try {
        await processRequest({ ctx, adapter: slackAdapter });
    } catch (error: any) {
        console.error(`Process failed for event ${event.id}:`, error.message);
        // Throwing will cause Pub/Sub to retry (up to the subscription's max retry)
        throw error;
    }
}
