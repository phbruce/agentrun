// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentitySource } from "../rbac/types.js";
import type { AgentResult } from "../agent/agentRunner.js";

export type FormatMode = "slack-mrkdwn" | "markdown" | "gchat-card" | "plain";

export interface ImageAttachment {
    url: string;
    mimeType: string;
    name?: string;
}

export interface ChannelContext {
    requestId: string;
    sessionId: string;
    userId: string;
    source: IdentitySource;
    query: string;
    isPrivate: boolean;
    responseUrl?: string;
    meta: Record<string, string>;
    images?: ImageAttachment[];
}

export interface ChannelAdapter {
    onProcessingStart(ctx: ChannelContext): Promise<void>;
    deliverResult(ctx: ChannelContext, result: AgentResult): Promise<void>;
    deliverError(ctx: ChannelContext, error: string): Promise<void>;
    deliverGreeting(ctx: ChannelContext): Promise<void>;
    onProcessingComplete(ctx: ChannelContext): Promise<void>;
}
