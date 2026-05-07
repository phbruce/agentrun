// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pluggable hook surface.
 *
 * Hooks let plugins observe or transform a tool call at well-defined
 * lifecycle points without modifying the orchestrator. Each phase
 * receives a structured context and may return a modified version.
 *
 * Phases:
 *  - `pre-tool-use` — fired before an executor runs. The hook may
 *    enrich, redact, or block (by returning `{ blocked: true, reason }`).
 *  - `post-tool-use` — fired after the executor returns. Useful for
 *    audit logging, usage tracking, redaction.
 *  - `boot` — fired once after the platform finishes registering
 *    providers/executors/factories. Useful for catalog validation.
 */

export type HookPhase = "pre-tool-use" | "post-tool-use" | "boot";

export interface PreToolUseContext {
    toolName: string;
    toolType?: string;
    args: Record<string, unknown>;
    userId?: string;
    role?: string;
    [key: string]: unknown;
}

export interface PreToolUseResult {
    /** Block the call. Hook is responsible for surfacing the reason. */
    blocked?: boolean;
    /** Human-readable reason when blocked. */
    reason?: string;
    /** Allow the hook to mutate args before the executor sees them. */
    args?: Record<string, unknown>;
}

export interface PostToolUseContext {
    toolName: string;
    toolType?: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs?: number;
    userId?: string;
    role?: string;
    [key: string]: unknown;
}

export interface BootContext {
    [key: string]: unknown;
}

/**
 * A hook is a single async function for a given phase. Implementations
 * may register multiple hooks for the same phase; they run in
 * registration order. A hook that throws aborts the chain — callers
 * decide whether to surface or swallow the error.
 */
export type PreToolUseHook = (ctx: PreToolUseContext) => Promise<PreToolUseResult | void>;
export type PostToolUseHook = (ctx: PostToolUseContext) => Promise<void>;
export type BootHook = (ctx: BootContext) => Promise<void>;

export type Hook = PreToolUseHook | PostToolUseHook | BootHook;

/**
 * Strongly-typed dispatch surface. The Platform exposes
 * `registerHook(phase, hook)` with these overloads so plugin authors
 * get autocomplete on the context shape.
 */
export interface HookRegistry {
    register(phase: "pre-tool-use", hook: PreToolUseHook): void;
    register(phase: "post-tool-use", hook: PostToolUseHook): void;
    register(phase: "boot", hook: BootHook): void;

    runPreToolUse(ctx: PreToolUseContext): Promise<PreToolUseResult>;
    runPostToolUse(ctx: PostToolUseContext): Promise<void>;
    runBoot(ctx: BootContext): Promise<void>;

    list(phase: HookPhase): readonly Hook[];
}
