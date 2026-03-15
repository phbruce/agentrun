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
} from "@agentrun-ai/core";
import type { ChannelContext } from "@agentrun-ai/core";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";
import { GChatChannelAdapter } from "@agentrun-ai/channel-gchat";
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
const gchatAdapter = new GChatChannelAdapter();

// ── SQS Handler ─────────────────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    await _bootstrap;
    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);
            const source = body.source ?? "slack";

            if (source === "gchat") {
                const { userId, text, meta } = body;
                const { spaceId, threadName, displayName } = meta ?? {};

                console.info(`Processing GChat query: user=${userId} space=${spaceId}`);

                // Load GChat secret on first use
                if (process.env.AGENTRUN_GCHAT_SECRET_ARN && !process.env.GCHAT_SERVICE_ACCOUNT_KEY) {
                    const { GetSecretValueCommand, SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
                    const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
                    const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.AGENTRUN_GCHAT_SECRET_ARN }));
                    if (res.SecretString) process.env.GCHAT_SERVICE_ACCOUNT_KEY = res.SecretString;
                }

                const ctx: ChannelContext = {
                    requestId: record.messageId,
                    sessionId: threadName ? `gchat:${spaceId}#${threadName}` : `gchat:${spaceId}#${record.messageId}`,
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

                await processRequest({ ctx, adapter: gchatAdapter });
            } else {
                // Slack (default, backwards-compatible)
                const { userId, channelId, text, responseUrl, threadTs, messageTs } = body;

                const isDm = channelId?.startsWith("D") ?? false;

                console.info(`Processing query: user=${userId} channel=${channelId} isDm=${isDm}`);

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
            }
        } catch (error: any) {
            console.error(`Process failed for message ${record.messageId}:`, error.message);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
}
