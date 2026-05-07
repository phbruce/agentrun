// SPDX-License-Identifier: AGPL-3.0-only

/**
 * JSON-RPC 2.0 transport types shared by core and the in-process MCP server.
 *
 * The MCP protocol uses JSON-RPC 2.0 over a transport (stdio, HTTP, SSE,
 * Streamable HTTP). These types model a single request/response exchange
 * regardless of the transport. Callers wrap them with whatever framing
 * their transport requires.
 */

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id?: string | number;
    result?: unknown;
    error?: JsonRpcErrorObject;
}

/**
 * A JSON-RPC handler answers a single request and returns the response.
 * Stateless from the caller's perspective; implementations may keep
 * internal state (sessions, capabilities) but each call is self-contained.
 */
export interface JsonRpcHandler {
    handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
}
