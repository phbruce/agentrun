// SPDX-License-Identifier: AGPL-3.0-only

import type { ChannelAdapter, ChannelContext, AgentResult } from "@agentrun-ai/core";
import { getDisplayName, getRoleForUser } from "@agentrun-ai/core";
import { postMessage, createCardMessage, updateMessage } from "./gchatClient.js";
import { formatAgentResponse, formatErrorResponse, formatGreetingCard } from "./formatting.js";

/**
 * Google Chat channel adapter for AgentRun.
 *
 * Translates agent lifecycle events into Google Chat interactions:
 * - "Processando..." placeholder message on start
 * - Card messages for results and greetings
 * - Message updates for replacing placeholder content
 *
 * Expected `ctx.meta` keys:
 * - `spaceId`  — Google Chat space identifier (e.g., "spaces/AAAA...")
 * - `threadName` — thread name for threaded replies (optional)
 * - `pendingMessageName` — set internally after sending the placeholder
 */
export class GChatChannelAdapter implements ChannelAdapter {
    async onProcessingStart(ctx: ChannelContext): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        if (spaceId) {
            const msg = await postMessage(spaceId, "Processando...", threadName || undefined);
            if (msg?.name) {
                ctx.meta.pendingMessageName = msg.name;
            }
        }
    }

    async deliverResult(ctx: ChannelContext, result: AgentResult): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        const card = formatAgentResponse(result);

        if (ctx.meta.pendingMessageName) {
            // Update the placeholder message with the real answer
            await updateMessage(ctx.meta.pendingMessageName, result.answer);
        } else if (spaceId) {
            await createCardMessage(spaceId, card, threadName || undefined);
        }
    }

    async deliverError(ctx: ChannelContext, error: string): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        const card = formatErrorResponse(error);

        if (ctx.meta.pendingMessageName) {
            await updateMessage(ctx.meta.pendingMessageName, `Erro: ${error}`);
        } else if (spaceId) {
            await createCardMessage(spaceId, card, threadName || undefined);
        }
    }

    async deliverGreeting(ctx: ChannelContext): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        const displayName = getDisplayName(ctx.userId, ctx.source);
        const role = getRoleForUser(ctx.userId, ctx.source);
        const card = formatGreetingCard(displayName, role);
        if (spaceId) {
            await createCardMessage(spaceId, card, threadName || undefined);
        }
    }

    async onProcessingComplete(_ctx: ChannelContext): Promise<void> {
        // No-op for Google Chat (no emoji reactions to update)
    }
}
