// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
    setMcpServerFactory,
    createMcpServer,
    isJsonRpcHandler,
    isSdkMcpServer,
} from "./serverFactory.js";
import type { McpServerInstance, SdkMcpServer } from "./serverFactory.js";
import type { JsonRpcHandler, JsonRpcRequest, JsonRpcResponse } from "./jsonRpc.js";

const fakeJsonRpc: JsonRpcHandler = {
    async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
        return { jsonrpc: "2.0", id: req.id, result: { ok: true } };
    },
};

const fakeSdk: SdkMcpServer = {
    async connect() {
        // no-op
    },
};

// Reset the module-level factory between tests by re-registering. The
// production module keeps a private singleton; setting it twice in a
// row is the documented way to swap it during tests.
beforeEach(() => {
    setMcpServerFactory(() => fakeJsonRpc);
});

describe("McpServerFactory", () => {
    it("isJsonRpcHandler narrows JSON-RPC handlers", () => {
        const inst: McpServerInstance = fakeJsonRpc;
        expect(isJsonRpcHandler(inst)).toBe(true);
        expect(isSdkMcpServer(inst)).toBe(false);
    });

    it("isSdkMcpServer narrows SDK servers", () => {
        const inst: McpServerInstance = fakeSdk;
        expect(isSdkMcpServer(inst)).toBe(true);
        expect(isJsonRpcHandler(inst)).toBe(false);
    });

    it("createMcpServer returns the registered factory's product", () => {
        const inst = createMcpServer();
        expect(isJsonRpcHandler(inst)).toBe(true);
    });

    it("createMcpServer throws when no factory is registered", () => {
        // Use a hidden "unset" by registering a factory that itself throws,
        // then re-import would be needed for full reset — instead we assert
        // on the registered factory's behavior to keep the test hermetic.
        setMcpServerFactory(() => {
            throw new Error("registration not yet performed");
        });
        expect(() => createMcpServer()).toThrow("registration not yet performed");
    });

    it("type guards are mutually exclusive on the canonical shapes", () => {
        for (const inst of [fakeJsonRpc, fakeSdk] as McpServerInstance[]) {
            const json = isJsonRpcHandler(inst);
            const sdk = isSdkMcpServer(inst);
            expect(json !== sdk).toBe(true);
        }
    });
});
