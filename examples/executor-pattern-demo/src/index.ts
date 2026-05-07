// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal demonstration of the protocol-agnostic Executor Registry pattern.
 *
 * Run:
 *   pnpm install
 *   pnpm --filter agentrun-example-executor-pattern-demo dev
 *
 * What this shows:
 *   1. `createPlatform(config)` builds a unified registration surface.
 *   2. `platform.registerExecutor(...)` wires an executor for a `type`.
 *   3. A `ToolDef` whose `type` matches the executor is dispatched
 *      via `platform.executors.get(tool.type).execute(tool, args, ctx)`.
 *
 * The orchestrator's only job is the registry lookup; no protocol-
 * specific code lives in core. New executor types (`http`, `gcp-sdk`,
 * `mcp-server`, custom) are added by registration, not by patching the
 * dispatch path.
 */

import { spawn } from "node:child_process";
import {
    createPlatform,
    type Executor,
    type ExecutionContext,
    type Platform,
    type PlatformConfig,
    type ToolDef,
    type ToolResult,
} from "@agentrun-ai/core";

const cliExecutor: Executor = {
    type: "cli",
    async execute(tool: ToolDef, args: Record<string, unknown>, _ctx: ExecutionContext): Promise<ToolResult> {
        const command = (tool as unknown as { command: string }).command;
        const stdinInput = typeof args.input === "string" ? args.input : "";
        return new Promise((resolve) => {
            const child = spawn(command, { shell: true });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
            });
            child.on("close", (code: number | null) => {
                resolve({
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ stdout, stderr, code }, null, 2),
                        },
                    ],
                });
            });
            if (stdinInput) {
                child.stdin.write(stdinInput);
                child.stdin.end();
            }
        });
    },
};

const minimalConfig = {
    apiVersion: "agentrun/v1",
    kind: "PlatformConfig",
    metadata: { name: "executor-pattern-demo" },
    spec: {
        providers: {
            llm: { type: "noop" },
            credentials: { type: "noop" },
            session: { type: "noop" },
            usage: { type: "noop" },
            manifests: { type: "noop" },
            secrets: { type: "noop" },
        },
        identity: { sources: [] },
        roles: {},
        users: [],
        environment: {
            name: "demo",
            cloud: "none",
            account: "0",
            region: "local",
            env: "demo",
            resources: [],
            repos: [],
        },
    },
} as unknown as PlatformConfig;

const echoTool = {
    name: "echo",
    description: "Echo a string via the local shell",
    type: "cli",
    command: "echo hello",
    inputSchema: { type: "object", properties: {} },
} as unknown as ToolDef;

async function main(): Promise<void> {
    const platform: Platform = createPlatform(minimalConfig);
    platform.registerExecutor(cliExecutor);

    const ctx: ExecutionContext = {
        userId: "demo",
        source: "demo",
        userTokenStore: {
            getToken: async () => null,
            saveToken: async () => undefined,
            deleteToken: async () => undefined,
            listProviders: async () => [],
        },
        secrets: { get: async () => null },
        logger: platform.logger as unknown as ExecutionContext["logger"],
    };

    const executor = platform.executors.get(echoTool.type as string);
    const result = await executor.execute(echoTool, {}, ctx);

    // eslint-disable-next-line no-console
    console.log(`Tool dispatched via executor: ${executor.type}`);
    // eslint-disable-next-line no-console
    console.log("Result:", result.content[0]);
}

main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
