// SPDX-License-Identifier: AGPL-3.0-only

import type { AwsClients } from "./clientFactory.js";
import type { ResolvedSecrets } from "../secret/types.js";

export interface ToolHandler {
    name: string;
    handler: (args: any, extra: unknown) => Promise<any>;
}

type ToolFactory = (awsClients?: AwsClients) => Map<string, ToolHandler>;

const _factories: ToolFactory[] = [];
const _packToolFactories = new Map<string, Record<string, (secrets: ResolvedSecrets) => ToolHandler>>();

/**
 * Register a tool factory that provides tools for the registry.
 * Tool packages (e.g., @agentrun-ai/tools-aws) call this to register their tools.
 */
export function registerToolFactory(factory: ToolFactory): void {
    _factories.push(factory);
}

/**
 * Get the merged tool registry from all registered factories.
 */
export function getToolRegistry(awsClients?: AwsClients): Map<string, ToolHandler> {
    const merged = new Map<string, ToolHandler>();
    for (const factory of _factories) {
        const tools = factory(awsClients);
        for (const [name, tool] of tools) {
            merged.set(name, tool);
        }
    }
    return merged;
}

/**
 * Register a tool factory for a specific pack.
 */
export function registerPackToolFactory(
    packName: string,
    toolName: string,
    factory: (secrets: ResolvedSecrets) => ToolHandler,
): void {
    const existing = _packToolFactories.get(packName) ?? {};
    existing[toolName] = factory;
    _packToolFactories.set(packName, existing);
}

/**
 * Get pack-specific tool factories.
 */
export function getPackToolFactories(packName: string): Record<string, (secrets: ResolvedSecrets) => ToolHandler> {
    return _packToolFactories.get(packName) ?? {};
}

/**
 * Build a tool registry merged from:
 *  - Global tool factories registered via `registerToolFactory`
 *  - Pack-scoped tool factories registered via `registerPackToolFactory`
 *    for each pack in `packNames`
 *
 * Pack-scoped tools take precedence over globals when names collide
 * (the pack is more specific than the runtime). Within a single pass,
 * the iteration order of `packNames` determines which pack wins on
 * cross-pack collisions; callers should provide a stable order.
 *
 * `secrets` is a fully-resolved Map<string, string> the caller obtained
 * from a SecretResolver before invoking this function. Each pack
 * factory is given the same map; pack factories are responsible for
 * reading only the keys they need.
 */
export function getToolRegistryWithPacks(
    packNames: readonly string[],
    secrets: ResolvedSecrets,
    awsClients?: AwsClients,
): Map<string, ToolHandler> {
    const merged = getToolRegistry(awsClients);
    for (const packName of packNames) {
        const factories = _packToolFactories.get(packName);
        if (!factories) continue;
        for (const [toolName, factory] of Object.entries(factories)) {
            merged.set(toolName, factory(secrets));
        }
    }
    return merged;
}

/**
 * Reset internal registries. Tests call this to keep state hermetic.
 * Not exported from index.ts; consumers shouldn't need it in production.
 */
export function _resetToolRegistries(): void {
    _factories.length = 0;
    _packToolFactories.clear();
}
