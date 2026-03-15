// SPDX-License-Identifier: AGPL-3.0-only

import type { ChannelAdapter, ChannelContext, AgentResult } from "@agentrun-ai/core";
import { getDisplayName, getRoleForUser } from "@agentrun-ai/core";
import { createCardMessage } from "./gchatClient.js";
import { formatAgentResponse, formatErrorResponse, formatGreetingCard } from "./formatting.js";

/**
 * Google Chat channel adapter for AgentRun.
 *
 * Translates agent lifecycle events into Google Chat interactions:
 * - "Analisando..." placeholder in the thread on start
 * - Card messages for results and greetings (with profile, tools, usage)
 * - Message updates for replacing placeholder content
 *
 * Expected `ctx.meta` keys:
 * - `spaceId`  — Google Chat space identifier (e.g., "spaces/AAAA...")
 * - `threadName` — thread name for threaded replies (optional)
 * - `pendingMessageName` — set internally after sending the placeholder
 */
export class GChatChannelAdapter implements ChannelAdapter {
    async onProcessingStart(_ctx: ChannelContext): Promise<void> {
        // No placeholder — Google Chat shows "Message deleted" when we delete,
        // and doesn't support emoji reactions. The card arrives directly.
    }

    async deliverResult(ctx: ChannelContext, result: AgentResult): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        if (!spaceId) return;
        const card = formatAgentResponse(result, ctx.userId, ctx.source);
        await createCardMessage(spaceId, card, threadName || undefined);
    }

    async deliverError(ctx: ChannelContext, error: string): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        if (!spaceId) return;
        const errorCard = formatErrorResponse(error);
        await createCardMessage(spaceId, errorCard, threadName || undefined);
    }

    async deliverGreeting(ctx: ChannelContext): Promise<void> {
        const { spaceId, threadName } = ctx.meta;
        if (!spaceId) return;
        const displayName = getDisplayName(ctx.userId, ctx.source);
        const role = getRoleForUser(ctx.userId, ctx.source);
        const card = await formatGreetingCard(displayName, role, ctx.userId, ctx.source);
        await createCardMessage(spaceId, card, threadName || undefined);
    }

    async onProcessingComplete(_ctx: ChannelContext): Promise<void> {
        // No-op for Google Chat (no emoji reactions to update)
    }
}
