// SPDX-License-Identifier: AGPL-3.0-only

import type { PlatformConfig } from "./types.js";
import { logger as defaultLogger } from "../logger.js";

type Logger = typeof defaultLogger;
import { ExecutorRegistry } from "../executor/registry.js";
import type { Executor } from "../executor/types.js";
import { setMcpServerFactory } from "../mcp/serverFactory.js";
import type { McpServerFactory } from "../mcp/serverFactory.js";
import { setClientFactory } from "../mcp/clientFactory.js";
import type { ClientFactory } from "../mcp/clientFactory.js";
import { DefaultHookRegistry } from "../hooks/registry.js";
import type { HookRegistry, HookPhase, PreToolUseHook, PostToolUseHook, BootHook } from "../hooks/types.js";
import { PlatformRegistry } from "./registry.js";
import type { PlatformProviders } from "./registry.js";

/**
 * Unified Platform interface.
 *
 * Replaces the fragmented set of global setters
 * (`setProviderRegistrar`, `setMcpServerFactory`, `setClientFactory`,
 * `registerToolFactory`) with a single object that plugins receive at
 * boot. Every registration happens through this object so multiple
 * plugins can compose without overwriting one another.
 *
 * The legacy global setters remain for backward compatibility and
 * forward to the same underlying singletons; new code should use
 * `createPlatform()` and the plugin contract.
 */
export interface Platform {
    /** Loaded platform config — read-only at runtime. */
    readonly config: PlatformConfig;

    /** Shared logger; plugins should use this rather than instantiating their own. */
    readonly logger: Logger;

    /** Executor registry — protocol-agnostic dispatch by `type`. */
    readonly executors: ExecutorRegistry;

    /** Pluggable hooks — see HookRegistry for the typed phases. */
    readonly hooks: HookRegistry;

    /** Provider registry — see PlatformRegistry for the existing surface. */
    readonly providers: PlatformRegistry;

    // -- Convenience registration shortcuts ---------------------------------

    /** Register a single executor by `type`. Throws on duplicate type. */
    registerExecutor(executor: Executor): void;

    /** Replace the platform-wide provider bundle. */
    registerProviders(providers: PlatformProviders): void;

    /** Register the SDK/JSON-RPC server factory consumed by `createMcpServer`. */
    registerMcpServerFactory(factory: McpServerFactory): void;

    /** Register the AWS client factory consumed by `createClientsForIdentity`. */
    registerClientFactory(factory: ClientFactory): void;

    /** Register a hook for a phase. See `HookRegistry` for typed phases. */
    registerHook(phase: "pre-tool-use", hook: PreToolUseHook): void;
    registerHook(phase: "post-tool-use", hook: PostToolUseHook): void;
    registerHook(phase: "boot", hook: BootHook): void;
    registerHook(phase: HookPhase, hook: PreToolUseHook | PostToolUseHook | BootHook): void;
}

/**
 * Default Platform implementation. Wraps the existing singletons so
 * the new API and the legacy setters interoperate during the
 * deprecation window.
 */
export class DefaultPlatform implements Platform {
    readonly config: PlatformConfig;
    readonly logger: Logger;
    readonly executors: ExecutorRegistry;
    readonly hooks: HookRegistry;
    readonly providers: PlatformRegistry;

    constructor(config: PlatformConfig, opts?: { logger?: Logger; executors?: ExecutorRegistry; hooks?: HookRegistry; providers?: PlatformRegistry }) {
        this.config = config;
        this.logger = opts?.logger ?? defaultLogger;
        this.executors = opts?.executors ?? new ExecutorRegistry();
        this.hooks = opts?.hooks ?? new DefaultHookRegistry();
        this.providers = opts?.providers ?? PlatformRegistry.instance();
        this.providers.setConfig(config);
    }

    registerExecutor(executor: Executor): void {
        this.executors.register(executor);
    }

    registerProviders(providers: PlatformProviders): void {
        this.providers.register(providers);
    }

    registerMcpServerFactory(factory: McpServerFactory): void {
        setMcpServerFactory(factory);
    }

    registerClientFactory(factory: ClientFactory): void {
        setClientFactory(factory);
    }

    registerHook(phase: HookPhase, hook: PreToolUseHook | PostToolUseHook | BootHook): void {
        // The HookRegistry has overloaded register; we forward via the
        // generic phase signature.
        switch (phase) {
            case "pre-tool-use":
                this.hooks.register("pre-tool-use", hook as PreToolUseHook);
                return;
            case "post-tool-use":
                this.hooks.register("post-tool-use", hook as PostToolUseHook);
                return;
            case "boot":
                this.hooks.register("boot", hook as BootHook);
                return;
            default: {
                const exhaustive: never = phase;
                throw new Error(`Unknown hook phase: ${String(exhaustive)}`);
            }
        }
    }
}

/**
 * Plugin contract: every `@agentrun-ai/*` plugin exports a default
 * function with this shape. The bootstrap loop calls it once at boot
 * with the shared `Platform`, letting the plugin contribute everything
 * it has — executors, providers, factories, hooks — through one entry
 * point.
 */
export type AgentrunPlugin = (platform: Platform) => void | Promise<void>;

/**
 * Create a Platform with sensible defaults. Most callers should use
 * this; advanced consumers can pass their own logger/executors/hooks.
 */
export function createPlatform(
    config: PlatformConfig,
    opts?: { logger?: Logger; executors?: ExecutorRegistry; hooks?: HookRegistry; providers?: PlatformRegistry },
): Platform {
    return new DefaultPlatform(config, opts);
}
