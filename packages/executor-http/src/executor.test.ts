// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, jest } from "@jest/globals";
import { HttpExecutor } from "./index.js";
import { resolvePathTemplate } from "./pathTemplate.js";
import type { ExecutionContext, ToolDef, UserToken } from "@agentrun-ai/core";
import { MissingUserTokenError } from "@agentrun-ai/core";

const noopLogger = {
    info: () => undefined,
    error: () => undefined,
};

const makeCtx = (token: { accessToken: string } | null = null): ExecutionContext => ({
    userId: "u1",
    source: "test",
    userTokenStore: {
        getToken: async (): Promise<UserToken | null> =>
            token ? { ...token, tokenType: "bearer", savedAt: 1 } : null,
        saveToken: async () => undefined,
        deleteToken: async () => undefined,
        listProviders: async () => [],
    },
    secrets: { get: async () => null },
    logger: noopLogger,
});

describe("resolvePathTemplate", () => {
    it("encodes by default and respects :raw", () => {
        expect(resolvePathTemplate("/x/{key}", { key: "a b" })).toBe("/x/a%20b");
        expect(resolvePathTemplate("/x/{key:raw}", { key: "a/b" })).toBe("/x/a/b");
    });
    it("uses default after pipe", () => {
        expect(resolvePathTemplate("/x/{key|abc}", {})).toBe("/x/abc");
    });
});

describe("HttpExecutor", () => {
    const makeTool = (auth?: { type: "bearer" | "basic" }): ToolDef => ({
        name: "demo",
        type: "http",
        description: "demo",
        category: "demo-provider",
        http: {
            baseUrl: "https://example.com",
            method: "GET",
            path: "/api/x?label={label|hi}",
            auth,
        },
    });

    it("performs an unauthenticated GET", async () => {
        const fetchMock = jest.fn(async () => new Response('{"ok":true}', { status: 200 }));
        const executor = new HttpExecutor({ fetch: fetchMock as unknown as typeof fetch });
        const result = await executor.execute(makeTool(), { label: "world" }, makeCtx());
        expect(result.isError).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = (fetchMock.mock.calls[0] ?? [undefined, undefined]) as unknown as [unknown, RequestInit];
        expect(url).toBe("https://example.com/api/x?label=world");
        expect(init.method).toBe("GET");
    });

    it("throws MissingUserTokenError when auth required but token absent", async () => {
        const fetchMock = jest.fn();
        const executor = new HttpExecutor({ fetch: fetchMock as unknown as typeof fetch });
        await expect(
            executor.execute(makeTool({ type: "bearer" }), {}, makeCtx(null)),
        ).rejects.toBeInstanceOf(MissingUserTokenError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses Bearer header when token present and type=bearer", async () => {
        const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }));
        const executor = new HttpExecutor({ fetch: fetchMock as unknown as typeof fetch });
        await executor.execute(makeTool({ type: "bearer" }), {}, makeCtx({ accessToken: "T123" }));
        const init = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit;
        expect(init.headers).toMatchObject({ Authorization: "Bearer T123" });
    });

    it("uses Basic header (base64) when type=basic", async () => {
        const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }));
        const executor = new HttpExecutor({ fetch: fetchMock as unknown as typeof fetch });
        await executor.execute(
            makeTool({ type: "basic" }),
            {},
            makeCtx({ accessToken: "user@example.com:apitoken" }),
        );
        const init = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit;
        const expected = `Basic ${Buffer.from("user@example.com:apitoken").toString("base64")}`;
        expect(init.headers).toMatchObject({ Authorization: expected });
    });

    it("returns isError on HTTP non-2xx", async () => {
        const fetchMock = jest.fn(async () => new Response("nope", { status: 404 }));
        const executor = new HttpExecutor({ fetch: fetchMock as unknown as typeof fetch });
        const result = await executor.execute(makeTool(), {}, makeCtx());
        expect(result.isError).toBe(true);
    });
});
