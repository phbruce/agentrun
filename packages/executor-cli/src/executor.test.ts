// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliExecutor } from "./index.js";
import type { ExecutionContext, ToolDef } from "@agentrun-ai/core";

let dir: string;
const noopLogger = { info: () => undefined, error: () => undefined };

const makeCtx = (): ExecutionContext => ({
    userId: "u1",
    source: "test",
    userTokenStore: {
        getToken: async () => null,
        saveToken: async () => undefined,
        deleteToken: async () => undefined,
        listProviders: async () => [],
    },
    secrets: { get: async () => null },
    logger: noopLogger,
});

const makeTool = (impl: string, extras: Partial<ToolDef["cli"]> = {}): ToolDef => ({
    name: "demo",
    type: "cli",
    description: "demo",
    category: "diagnostics",
    cli: { impl, ...extras } as NonNullable<ToolDef["cli"]>,
});

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "executor-cli-"));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("CliExecutor", () => {
    it("runs a node .mjs impl and returns its JSON stdout", async () => {
        const file = join(dir, "impl.mjs");
        writeFileSync(
            file,
            `import { stdin } from "node:process";
let buf = "";
for await (const chunk of stdin) buf += chunk;
const { args } = JSON.parse(buf);
process.stdout.write(JSON.stringify({ ok: true, echoed: args }));
`,
        );
        const result = await new CliExecutor().execute(makeTool(file), { x: 42 }, makeCtx());
        expect(result.isError).toBeUndefined();
        const data = result.content[0]?.data as { ok: boolean; echoed: { x: number } };
        expect(data.ok).toBe(true);
        expect(data.echoed).toEqual({ x: 42 });
    });

    it("runs a Python .py impl and returns its JSON stdout", async () => {
        const file = join(dir, "impl.py");
        writeFileSync(
            file,
            `import sys, json
data = json.loads(sys.stdin.read())
print(json.dumps({"py_ok": True, "args": data["args"]}))
`,
        );
        const result = await new CliExecutor().execute(makeTool(file), { y: "hello" }, makeCtx());
        expect(result.isError).toBeUndefined();
        const data = result.content[0]?.data as { py_ok: boolean };
        expect(data.py_ok).toBe(true);
    });

    it("returns error result when subprocess exits non-zero", async () => {
        const file = join(dir, "impl.mjs");
        writeFileSync(file, "process.exit(2);");
        const result = await new CliExecutor().execute(makeTool(file), {}, makeCtx());
        expect(result.isError).toBe(true);
    });

    it("times out long-running subprocess", async () => {
        const file = join(dir, "impl.mjs");
        writeFileSync(file, "setTimeout(() => process.exit(0), 10_000);");
        const result = await new CliExecutor().execute(
            makeTool(file, { timeoutMs: 200 }),
            {},
            makeCtx(),
        );
        expect(result.isError).toBe(true);
    }, 5000);

    it("returns isError when cli.impl is missing from manifest", async () => {
        const tool: ToolDef = { name: "no-impl", type: "cli", description: "", category: "" };
        const result = await new CliExecutor().execute(tool, {}, makeCtx());
        expect(result.isError).toBe(true);
    });
});
