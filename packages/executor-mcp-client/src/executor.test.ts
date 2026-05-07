// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, jest } from "@jest/globals";
import { McpClientExecutor } from "./index.js";
import type { ExecutionContext, ToolDef } from "@agentrun-ai/core";

const noopLogger = { info: () => undefined, error: () => undefined };
const ctx: ExecutionContext = {
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
};

const makeTool = (server: string, tool?: string): ToolDef => ({
    name: "proxy-demo",
    type: "mcp-server",
    description: "proxy",
    category: "proxy",
    mcpServer: { server, tool: tool ?? "proxy-demo" },
});

describe("McpClientExecutor", () => {
    it("returns isError when no upstream server is configured", async () => {
        const exec = new McpClientExecutor();
        const result = await exec.execute(
            { name: "x", type: "mcp-server", description: "", category: "" },
            {},
            ctx,
        );
        expect(result.isError).toBe(true);
    });

    it("forwards tools/call to upstream and returns content", async () => {
        const fetchMock = jest.fn(async () =>
            new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: "abc",
                    result: { content: [{ type: "text", text: "upstream-says-hi" }] },
                }),
                { status: 200 },
            ),
        );
        const exec = new McpClientExecutor({ fetch: fetchMock as unknown as typeof fetch });
        const result = await exec.execute(
            makeTool("https://upstream.example/mcp"),
            { foo: 1 },
            ctx,
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.type).toBe("text");
        expect(result.content[0]?.text).toBe("upstream-says-hi");
        const callArgs = (fetchMock.mock.calls[0] ?? [undefined, undefined]) as unknown as [unknown, RequestInit];
        expect(callArgs[0]).toBe("https://upstream.example/mcp");
        const body = JSON.parse((callArgs[1] as RequestInit).body as string);
        expect(body.method).toBe("tools/call");
        expect(body.params.name).toBe("proxy-demo");
        expect(body.params.arguments).toEqual({ foo: 1 });
    });

    it("propagates upstream JSON-RPC error", async () => {
        const fetchMock = jest.fn(async () =>
            new Response(
                JSON.stringify({ jsonrpc: "2.0", id: "x", error: { code: -32601, message: "no such tool" } }),
                { status: 200 },
            ),
        );
        const exec = new McpClientExecutor({ fetch: fetchMock as unknown as typeof fetch });
        const result = await exec.execute(
            makeTool("https://upstream.example/mcp"),
            {},
            ctx,
        );
        expect(result.isError).toBe(true);
    });

    it("returns isError on HTTP non-2xx", async () => {
        const fetchMock = jest.fn(async () => new Response("bad", { status: 502 }));
        const exec = new McpClientExecutor({ fetch: fetchMock as unknown as typeof fetch });
        const result = await exec.execute(
            makeTool("https://upstream.example/mcp"),
            {},
            ctx,
        );
        expect(result.isError).toBe(true);
    });
});
