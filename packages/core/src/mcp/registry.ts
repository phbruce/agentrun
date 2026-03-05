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
 * Tool packages (e.g., @agentrun-oss/tools-aws) call this to register their tools.
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
