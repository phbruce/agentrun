// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from "@jest/globals";
import { createPlatform, DefaultPlatform } from "./Platform.js";
import { ExecutorRegistry } from "../executor/registry.js";
import { DefaultHookRegistry } from "../hooks/registry.js";
import { PlatformRegistry } from "./registry.js";
import type { PlatformConfig } from "./types.js";
import type { Executor, ExecutionContext, ToolResult } from "../executor/types.js";
import type { ToolDef } from "../catalog/types.js";

const minimalConfig = {
    apiVersion: "agentrun/v1",
    kind: "PlatformConfig",
    metadata: { name: "test" },
    spec: {
        providers: {
            llm: { type: "x" },
            credentials: { type: "x" },
            session: { type: "x" },
            usage: { type: "x" },
            manifests: { type: "x" },
            secrets: { type: "x" },
        },
        identity: { sources: [] },
        roles: {},
        users: [],
        environment: { name: "dev", cloud: "aws", account: "0", region: "us-east-1", env: "dev", resources: [], repos: [] },
    },
} as unknown as PlatformConfig;

const dummyExecutor: Executor = {
    type: "dummy",
    async execute(_tool: ToolDef, _args: Record<string, unknown>, _ctx: ExecutionContext): Promise<ToolResult> {
        return { content: [{ type: "text", text: "ok" }] };
    },
};

beforeEach(() => {
    PlatformRegistry.reset();
});

describe("Platform — unified interface", () => {
    it("createPlatform returns a DefaultPlatform with given config", () => {
        const p = createPlatform(minimalConfig);
        expect(p).toBeInstanceOf(DefaultPlatform);
        expect(p.config.metadata.name).toBe("test");
    });

    it("uses provided executors and hooks instances", () => {
        const executors = new ExecutorRegistry();
        const hooks = new DefaultHookRegistry();
        const p = createPlatform(minimalConfig, { executors, hooks });
        expect(p.executors).toBe(executors);
        expect(p.hooks).toBe(hooks);
    });

    it("registerExecutor delegates to ExecutorRegistry", () => {
        const p = createPlatform(minimalConfig);
        p.registerExecutor(dummyExecutor);
        expect(p.executors.has("dummy")).toBe(true);
    });

    it("rejects duplicate executor types", () => {
        const p = createPlatform(minimalConfig);
        p.registerExecutor(dummyExecutor);
        expect(() => p.registerExecutor(dummyExecutor)).toThrow(/already registered/);
    });
});

describe("Platform — hooks", () => {
    it("registers and runs a pre-tool-use hook", async () => {
        const p = createPlatform(minimalConfig);
        const seen: string[] = [];
        p.registerHook("pre-tool-use", async (ctx) => {
            seen.push(ctx.toolName);
        });

        const result = await p.hooks.runPreToolUse({ toolName: "x", args: {} });
        expect(result.blocked).toBeFalsy();
        expect(seen).toEqual(["x"]);
    });

    it("blocks the chain when a hook returns blocked", async () => {
        const p = createPlatform(minimalConfig);
        p.registerHook("pre-tool-use", async () => ({ blocked: true, reason: "rbac" }));
        let secondCalled = false;
        p.registerHook("pre-tool-use", async () => {
            secondCalled = true;
        });

        const result = await p.hooks.runPreToolUse({ toolName: "x", args: {} });
        expect(result).toEqual({ blocked: true, reason: "rbac" });
        expect(secondCalled).toBe(false);
    });

    it("threads args mutation across hooks in registration order", async () => {
        const p = createPlatform(minimalConfig);
        p.registerHook("pre-tool-use", async (ctx) => ({ args: { ...ctx.args, step1: true } }));
        p.registerHook("pre-tool-use", async (ctx) => ({ args: { ...ctx.args, step2: true } }));

        const result = await p.hooks.runPreToolUse({ toolName: "x", args: {} });
        expect(result.args).toEqual({ step1: true, step2: true });
    });

    it("runs post-tool-use hooks in order", async () => {
        const p = createPlatform(minimalConfig);
        const order: number[] = [];
        p.registerHook("post-tool-use", async () => {
            order.push(1);
        });
        p.registerHook("post-tool-use", async () => {
            order.push(2);
        });

        await p.hooks.runPostToolUse({ toolName: "x", args: {}, result: null });
        expect(order).toEqual([1, 2]);
    });

    it("runs boot hooks", async () => {
        const p = createPlatform(minimalConfig);
        let called = false;
        p.registerHook("boot", async () => {
            called = true;
        });
        await p.hooks.runBoot({});
        expect(called).toBe(true);
    });

    it("hooks.list returns the registered hooks for a phase", () => {
        const p = createPlatform(minimalConfig);
        const h1 = async () => undefined;
        const h2 = async () => undefined;
        p.registerHook("pre-tool-use", h1);
        p.registerHook("pre-tool-use", h2);
        expect(p.hooks.list("pre-tool-use").length).toBe(2);
    });
});
