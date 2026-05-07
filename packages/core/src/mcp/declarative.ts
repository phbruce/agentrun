// SPDX-License-Identifier: AGPL-3.0-only

import type { ToolDef, ManifestCatalog } from "../catalog/types.js";
import type { ResolvedSecrets } from "../secret/types.js";
import type { ToolHandler } from "./registry.js";
import type { ExecutorRegistry } from "../executor/registry.js";
import type { ExecutionContext } from "../executor/types.js";

/**
 * Hydrate a declarative tool definition into a callable handler.
 *
 * Historic note: prior to the executor-registry redesign, this returned
 * `null` and tool packages each implemented their own dispatch. The new
 * model unifies dispatch behind `ExecutorRegistry` — pass it explicitly to
 * obtain a handler that delegates by `tool.type`. The two-arg form (without
 * registry) is preserved for backward compatibility and still returns null
 * so callers can detect the legacy STUB and migrate.
 */
export function hydrateDeclarativeTool(
    tool: ToolDef,
    _secrets: Map<string, ResolvedSecrets>,
    registry?: ExecutorRegistry,
    contextFactory?: () => ExecutionContext,
): ToolHandler | null {
    if (!registry) return null;
    if (!registry.has(tool.type)) return null;
    const executor = registry.get(tool.type);
    return {
        name: tool.name,
        handler: async (args: Record<string, unknown>): Promise<unknown> => {
            const ctx =
                contextFactory?.() ??
                ({
                    userId: "system",
                    source: "internal",
                    userTokenStore: {
                        getToken: async () => null,
                        saveToken: async () => undefined,
                        deleteToken: async () => undefined,
                        listProviders: async () => [],
                    },
                    secrets: { get: async () => null },
                    logger: { info: () => undefined, error: () => undefined },
                } as ExecutionContext);
            return await executor.execute(tool, args, ctx);
        },
    };
}

/**
 * Hydrate workflow steps into callable MCP tools.
 *
 * For each workflow with explicit `steps[]`, synthesize a tool whose handler
 * runs the steps in order through the executor registry. The returned map
 * keys are workflow names; values are handlers that callers can register
 * with the regular tool registry.
 */
export function hydrateWorkflowAsTools(
    catalog: ManifestCatalog,
    secrets: Map<string, ResolvedSecrets>,
    registry?: ExecutorRegistry,
): Map<string, ToolHandler> {
    const out = new Map<string, ToolHandler>();
    if (!registry) return out;
    for (const [name, workflow] of catalog.workflows) {
        if (!workflow.steps || workflow.steps.length === 0) continue;
        const stepHandlers = workflow.steps
            .map((step) => {
                const tool = catalog.tools.get(step.tool);
                if (!tool) return null;
                const hydrated = hydrateDeclarativeTool(tool, secrets, registry);
                if (!hydrated) return null;
                return { step, handler: hydrated.handler };
            })
            .filter((s): s is { step: typeof workflow.steps[number]; handler: ToolHandler["handler"] } =>
                s !== null,
            );
        if (stepHandlers.length === 0) continue;
        out.set(name, {
            name,
            handler: async (args: Record<string, unknown>): Promise<unknown> => {
                const results: Record<string, unknown> = {};
                for (const { step, handler } of stepHandlers) {
                    const stepArgs = { ...args, ...(step.input ?? {}) };
                    results[step.name] = await handler(stepArgs, null);
                }
                return results;
            },
        });
    }
    return out;
}
