// SPDX-License-Identifier: AGPL-3.0-only

// SQS handler: processes queued queries through the AgentRun orchestrator.
// Each SQS message contains a Slack event (userId, channelId, text, threadTs).
// The handler bootstraps the platform, loads pack catalogs, and runs processRequest()
// which executes the full agent loop (classify -> select tools -> call LLM -> respond).

import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
    processRequest,
    bootstrapPlatform,
    loadCatalogForPacks,
    setCatalog,
} from "@agentrun-oss/core";
import type { ChannelContext } from "@agentrun-oss/core";
import { SlackChannelAdapter } from "@agentrun-oss/channel-slack";
import "../setup.js";

// ── Cold-start initialization ───────────────────────────────────────────────
// Bootstrap platform (reads config, registers providers) then load the pack
// catalog (tool/workflow/skill/use-case manifests from S3). setCatalog() makes
// the catalog globally available to the orchestrator and classifier.

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

// ── SQS Handler ─────────────────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    await _bootstrap;
    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);
            const { userId, channelId, text, responseUrl, threadTs, messageTs } = body;

            const isDm = channelId?.startsWith("D") ?? false;

            console.info(`Processing query: user=${userId} channel=${channelId} isDm=${isDm}`);

            // Build channel context — the orchestrator uses this to route responses
            // back to the correct Slack thread and to manage session state.
            const ctx: ChannelContext = {
                requestId: record.messageId,
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

            await processRequest({ ctx, adapter: slackAdapter });
        } catch (error: any) {
            console.error(`Process failed for message ${record.messageId}:`, error.message);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
}
