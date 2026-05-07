// SPDX-License-Identifier: AGPL-3.0-only

import type { AwsClients } from "./clientFactory.js";
import type { JsonRpcHandler } from "./jsonRpc.js";

/**
 * SDK-style MCP server (the variant emitted by `@modelcontextprotocol/sdk`).
 *
 * The Claude Agent SDK and other transport drivers consume servers through
 * a `connect(transport)` lifecycle. We accept any object that exposes that
 * surface — we don't import the SDK type directly because the SDK is an
 * optional peer dependency.
 */
export interface SdkMcpServer {
    connect(transport: unknown): Promise<void>;
}

/**
 * Return shape of a registered MCP server factory.
 *
 * Two variants coexist:
 *   1. SDK servers (used by the Claude Agent SDK transport) — implement
 *      `connect(transport)` and a number of other lifecycle methods.
 *   2. JSON-RPC handlers (used by the lightweight @agentrun-ai/channel-mcp
 *      server) — implement `handleRequest(req)` and are transport-agnostic.
 *
 * The two variants are structurally distinguishable; `isJsonRpcHandler`
 * and `isSdkMcpServer` discriminate at runtime when needed.
 */
export type McpServerInstance = SdkMcpServer | JsonRpcHandler;

export type McpServerFactory = (awsClients?: AwsClients) => McpServerInstance;

let _factory: McpServerFactory | null = null;

/**
 * Register the MCP server factory.
 * Called by tool packages to provide their MCP server implementation.
 */
export function setMcpServerFactory(factory: McpServerFactory): void {
    _factory = factory;
}

/**
 * Create an MCP server with registered tools.
 */
export function createMcpServer(awsClients?: AwsClients): McpServerInstance {
    if (!_factory) {
        throw new Error("No MCP server factory registered. Call setMcpServerFactory() first.");
    }
    return _factory(awsClients);
}

/** Type guard: does the instance speak JSON-RPC directly? */
export function isJsonRpcHandler(server: McpServerInstance): server is JsonRpcHandler {
    return typeof (server as JsonRpcHandler).handleRequest === "function";
}

/** Type guard: does the instance speak the SDK transport lifecycle? */
export function isSdkMcpServer(server: McpServerInstance): server is SdkMcpServer {
    return typeof (server as SdkMcpServer).connect === "function";
}
