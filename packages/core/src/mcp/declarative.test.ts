// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, jest } from "@jest/globals";
import { hydrateDeclarativeTool, hydrateWorkflowAsTools } from "./declarative.js";
import { ExecutorRegistry } from "../executor/registry.js";
import type { Executor } from "../executor/types.js";
import type { ToolDef, ManifestCatalog } from "../catalog/types.js";

function fakeRegistryWithEcho(): ExecutorRegistry {
    const reg = new ExecutorRegistry();
    const echo: Executor = {
        type: "echo",
        execute: jest.fn(async (tool: ToolDef, args: Record<string, unknown>) => ({
            content: [{ type: "json", data: { tool: tool.name, args } }],
        })) as Executor["execute"],
    };
    reg.register(echo);
    return reg;
}

const baseTool = (overrides: Partial<ToolDef> = {}): ToolDef => ({
    name: "demo",
    type: "echo",
    description: "demo",
    category: "diagnostics",
    ...overrides,
});

describe("hydrateDeclarativeTool", () => {
    it("returns null when no registry is provided (legacy STUB behavior)", () => {
        const handler = hydrateDeclarativeTool(baseTool(), new Map());
        expect(handler).toBeNull();
    });

    it("returns null when the tool's type has no registered executor", () => {
        const reg = fakeRegistryWithEcho();
        const handler = hydrateDeclarativeTool(baseTool({ type: "unknown-protocol" }), new Map(), reg);
        expect(handler).toBeNull();
    });

    it("returns a ToolHandler that dispatches through the registry", async () => {
        const reg = fakeRegistryWithEcho();
        const handler = hydrateDeclarativeTool(baseTool(), new Map(), reg);
        expect(handler).not.toBeNull();
        expect(handler!.name).toBe("demo");
        const result = await handler!.handler({ x: 1 }, null);
        expect((result as { content: Array<{ data: unknown }> }).content[0].data).toEqual({
            tool: "demo",
            args: { x: 1 },
        });
    });

    it("uses the supplied contextFactory when provided", async () => {
        const reg = new ExecutorRegistry();
        const captured: Array<{ userId: string; source: string }> = [];
        reg.register({
            type: "echo",
            execute: async (_tool, _args, ctx) => {
                captured.push({ userId: ctx.userId, source: ctx.source });
                return { content: [{ type: "text", text: "ok" }] };
            },
        });
        const handler = hydrateDeclarativeTool(baseTool(), new Map(), reg, () => ({
            userId: "alice",
            source: "test-bench",
            userTokenStore: {
                getToken: async () => null,
                saveToken: async () => undefined,
                deleteToken: async () => undefined,
                listProviders: async () => [],
            },
            secrets: { get: async () => null },
            logger: { info: () => undefined, error: () => undefined },
        }));
        await handler!.handler({}, null);
        expect(captured).toEqual([{ userId: "alice", source: "test-bench" }]);
    });
});

describe("hydrateWorkflowAsTools", () => {
    const emptyCatalog: ManifestCatalog = {
        tools: new Map(),
        skills: new Map(),
        workflows: new Map(),
        useCases: new Map(),
        knowledgeBases: new Map(),
        evals: new Map(),
    };

    it("returns empty map when no registry supplied", () => {
        const out = hydrateWorkflowAsTools(emptyCatalog, new Map());
        expect(out.size).toBe(0);
    });

    it("synthesizes a tool that walks workflow steps through the registry", async () => {
        const reg = fakeRegistryWithEcho();
        const tool: ToolDef = baseTool();
        const catalog: ManifestCatalog = {
            ...emptyCatalog,
            tools: new Map([["demo", tool]]),
            workflows: new Map([
                [
                    "two-step",
                    {
                        name: "two-step",
                        description: "runs demo twice",
                        tools: ["demo"],
                        steps: [
                            { name: "first", tool: "demo", input: { stage: 1 } },
                            { name: "second", tool: "demo", input: { stage: 2 } },
                        ],
                    },
                ],
            ]),
        };
        const out = hydrateWorkflowAsTools(catalog, new Map(), reg);
        expect(out.has("two-step")).toBe(true);
        const result = await out.get("two-step")!.handler({ shared: true }, null);
        expect(result).toMatchObject({
            first: { content: [{ data: { tool: "demo", args: { shared: true, stage: 1 } } }] },
            second: { content: [{ data: { tool: "demo", args: { shared: true, stage: 2 } } }] },
        });
    });

    it("skips workflows whose referenced tool is missing", () => {
        const reg = fakeRegistryWithEcho();
        const catalog: ManifestCatalog = {
            ...emptyCatalog,
            workflows: new Map([
                [
                    "broken",
                    {
                        name: "broken",
                        description: "references missing tool",
                        tools: ["does-not-exist"],
                        steps: [{ name: "x", tool: "does-not-exist" }],
                    },
                ],
            ]),
        };
        const out = hydrateWorkflowAsTools(catalog, new Map(), reg);
        expect(out.has("broken")).toBe(false);
    });
});
