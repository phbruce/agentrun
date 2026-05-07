// SPDX-License-Identifier: AGPL-3.0-only

import type {
    HookRegistry,
    HookPhase,
    Hook,
    PreToolUseHook,
    PostToolUseHook,
    BootHook,
    PreToolUseContext,
    PreToolUseResult,
    PostToolUseContext,
    BootContext,
} from "./types.js";

/**
 * Default in-memory hook registry.
 *
 * Hooks per phase run in registration order. The first pre-tool-use
 * hook to return `blocked: true` short-circuits the chain — the
 * remaining hooks for that phase are not called. Args mutation
 * accumulates: each hook sees the previous hook's mutated args.
 */
export class DefaultHookRegistry implements HookRegistry {
    private readonly preToolUse: PreToolUseHook[] = [];
    private readonly postToolUse: PostToolUseHook[] = [];
    private readonly boot: BootHook[] = [];

    register(phase: "pre-tool-use", hook: PreToolUseHook): void;
    register(phase: "post-tool-use", hook: PostToolUseHook): void;
    register(phase: "boot", hook: BootHook): void;
    register(phase: HookPhase, hook: Hook): void {
        switch (phase) {
            case "pre-tool-use":
                this.preToolUse.push(hook as PreToolUseHook);
                return;
            case "post-tool-use":
                this.postToolUse.push(hook as PostToolUseHook);
                return;
            case "boot":
                this.boot.push(hook as BootHook);
                return;
            default: {
                const exhaustive: never = phase;
                throw new Error(`Unknown hook phase: ${String(exhaustive)}`);
            }
        }
    }

    async runPreToolUse(ctx: PreToolUseContext): Promise<PreToolUseResult> {
        let mutableArgs = ctx.args;
        for (const hook of this.preToolUse) {
            const out = await hook({ ...ctx, args: mutableArgs });
            if (!out) continue;
            if (out.blocked) {
                return { blocked: true, reason: out.reason ?? "Blocked by hook" };
            }
            if (out.args) {
                mutableArgs = out.args;
            }
        }
        return { blocked: false, args: mutableArgs };
    }

    async runPostToolUse(ctx: PostToolUseContext): Promise<void> {
        for (const hook of this.postToolUse) {
            await hook(ctx);
        }
    }

    async runBoot(ctx: BootContext): Promise<void> {
        for (const hook of this.boot) {
            await hook(ctx);
        }
    }

    list(phase: HookPhase): readonly Hook[] {
        switch (phase) {
            case "pre-tool-use":
                return this.preToolUse;
            case "post-tool-use":
                return this.postToolUse;
            case "boot":
                return this.boot;
            default: {
                const exhaustive: never = phase;
                throw new Error(`Unknown hook phase: ${String(exhaustive)}`);
            }
        }
    }
}
