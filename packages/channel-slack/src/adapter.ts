// SPDX-License-Identifier: AGPL-3.0-only

import type { ChannelAdapter, ChannelContext, AgentResult } from "@agentrun-oss/core";
import { postToResponseUrl, postThreadMessage, addReaction } from "./slackClient.js";
import { formatAgentResponse, formatErrorResponse } from "./blockKit.js";
import { formatGreeting } from "./formatting.js";

/**
 * Slack channel adapter for AgentRun.
 *
 * Translates agent lifecycle events into Slack-native interactions:
 * - Reactions for processing state
 * - Block Kit rich messages for results
 * - Thread replies or response_url payloads for delivery
 */
export class SlackChannelAdapter implements ChannelAdapter {
    async onProcessingStart(ctx: ChannelContext): Promise<void> {
        const { messageTs, channelId } = ctx.meta;
        if (messageTs && channelId) {
            addReaction(channelId, messageTs, "eyes").catch(() => {});
        }
    }

    async deliverResult(ctx: ChannelContext, result: AgentResult): Promise<void> {
        const blocks = result.error
            ? formatErrorResponse(ctx.query, result.error)
            : await formatAgentResponse(ctx.query, result.answer, result.toolsUsed, result.durationMs, {
                  input: result.inputTokens,
                  output: result.outputTokens,
              }, ctx.userId);

        await this.deliver(ctx, result.error ? `Error: ${result.error}` : "", blocks);
    }

    async deliverError(ctx: ChannelContext, error: string): Promise<void> {
        const blocks = formatErrorResponse(ctx.query, error);
        await this.deliver(ctx, `Error: ${error}`, blocks);
    }

    async deliverGreeting(ctx: ChannelContext): Promise<void> {
        const blocks = await formatGreeting(ctx.userId);
        await this.deliver(ctx, "", blocks);
    }

    async onProcessingComplete(ctx: ChannelContext): Promise<void> {
        const { messageTs, channelId } = ctx.meta;
        if (messageTs && channelId) {
            addReaction(channelId, messageTs, "white_check_mark").catch(() => {});
        }
    }

    private async deliver(ctx: ChannelContext, fallbackText: string, blocks: any[]): Promise<void> {
        const { threadTs, channelId } = ctx.meta;
        if (threadTs && channelId) {
            await postThreadMessage(channelId, threadTs, fallbackText, blocks);
        } else if (ctx.responseUrl) {
            await postToResponseUrl(ctx.responseUrl, {
                response_type: "in_channel",
                replace_original: true,
                blocks,
            });
        }
    }
}
