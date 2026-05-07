// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Protocol-agnostic Executor primitives.
 *
 * The runtime delegates every tool dispatch through an `ExecutorRegistry`
 * indexed by `tool.type` (`http`, `cli`, `mcp-server`, `gcp-sdk`, ...).
 * Adding a new protocol = publishing a new package that registers an
 * executor via the plugin contract. The runtime itself does not branch on
 * protocol.
 */

import type { ToolDef } from "../catalog/types.js";
import type { UserTokenStore, ContentBlock } from "../platform/types.js";

export type { ContentBlock };

export interface ToolResult {
    content: ContentBlock[];
    isError?: boolean;
}

export interface SecretResolver {
    get(name: string): Promise<string | null>;
}

export interface ExecutionContext {
    userId: string;
    team?: string;
    source: string;
    userTokenStore: UserTokenStore;
    secrets: SecretResolver;
    logger: {
        info: (msg: string, ...args: unknown[]) => void;
        error: (msg: string, ...args: unknown[]) => void;
    };
}

export interface Executor {
    readonly type: string;
    execute(
        tool: ToolDef,
        args: Record<string, unknown>,
        ctx: ExecutionContext,
    ): Promise<ToolResult>;
}
