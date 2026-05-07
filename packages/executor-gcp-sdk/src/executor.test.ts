// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, jest } from "@jest/globals";
import { GcpSdkExecutor } from "./index.js";
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

describe("GcpSdkExecutor", () => {
    it("returns isError when tool has no gcpSdk.operation", async () => {
        const exec = new GcpSdkExecutor();
        const tool: ToolDef = { name: "no-op", type: "gcp-sdk", description: "", category: "" };
        const result = await exec.execute(tool, {}, ctx);
        expect(result.isError).toBe(true);
    });

    it("returns isError when operation has no handler", async () => {
        const exec = new GcpSdkExecutor();
        const tool: ToolDef = {
            name: "x",
            type: "gcp-sdk",
            description: "",
            category: "",
            gcpSdk: { operation: "unknown.op" },
        };
        const result = await exec.execute(tool, {}, ctx);
        expect(result.isError).toBe(true);
    });

    it("dispatches custom handler", async () => {
        const exec = new GcpSdkExecutor({
            handlers: { "custom.op": async (_t, args) => ({ ok: true, args }) },
        });
        const tool: ToolDef = {
            name: "x",
            type: "gcp-sdk",
            description: "",
            category: "",
            gcpSdk: { operation: "custom.op" },
        };
        const result = await exec.execute(tool, { foo: 1 }, ctx);
        expect(result.isError).toBeUndefined();
        expect((result.content[0]?.data as { ok: boolean }).ok).toBe(true);
    });

    it("calls Discovery Engine with the right URL and returns mapped chunks", async () => {
        const fetchMock = jest.fn(async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            document: {
                                id: "d1",
                                derivedStructData: { snippets: [{ snippet: "hello" }] },
                                structData: { pack: "p" },
                            },
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        const exec = new GcpSdkExecutor({
            projectId: "proj-x",
            location: "global",
            dataStore: "demo-knowledge",
            fetch: fetchMock as unknown as typeof fetch,
            accessToken: async () => "FAKE-TOKEN",
        });
        const tool: ToolDef = {
            name: "knowledge-search",
            type: "gcp-sdk",
            description: "",
            category: "",
            gcpSdk: { operation: "discoveryengine.search" },
        };
        const result = await exec.execute(tool, { query: "deploy", topK: 3 }, ctx);
        expect(result.isError).toBeUndefined();
        const data = result.content[0]?.data as {
            dataStore: string;
            results: Array<{ id: string; snippets: string[] }>;
        };
        expect(data.dataStore).toBe("demo-knowledge");
        expect(data.results[0]?.id).toBe("d1");
        expect(data.results[0]?.snippets[0]).toBe("hello");
        const callArgs = (fetchMock.mock.calls[0] ?? [undefined, undefined]) as unknown as [unknown, RequestInit];
        const url = callArgs[0] as string;
        expect(url).toContain("/projects/proj-x/locations/global/");
        expect(url).toContain("/dataStores/demo-knowledge/");
        expect((callArgs[1] as RequestInit).method).toBe("POST");
        expect((callArgs[1] as RequestInit).headers).toMatchObject({
            Authorization: "Bearer FAKE-TOKEN",
        });
    });

    it("requires query argument for discoveryengine.search", async () => {
        const exec = new GcpSdkExecutor({
            projectId: "p",
            dataStore: "ds",
            accessToken: async () => "T",
        });
        const tool: ToolDef = {
            name: "s",
            type: "gcp-sdk",
            description: "",
            category: "",
            gcpSdk: { operation: "discoveryengine.search" },
        };
        const result = await exec.execute(tool, {}, ctx);
        expect(result.isError).toBe(true);
    });
});
