// SPDX-License-Identifier: AGPL-3.0-only

import { logger, getToolRegistry } from "@agentrun-oss/core";
import type { ToolHandler } from "@agentrun-oss/core";

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id?: string | number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP Server Options
// ---------------------------------------------------------------------------

export interface McpServerOptions {
    /** Server name exposed via initialize. */
    name: string;
    /** Server version exposed via initialize. */
    version?: string;
    /** Optional override for the tool registry. */
    tools?: Map<string, ToolHandler>;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/**
 * Lightweight MCP server that exposes registered tools via JSON-RPC.
 *
 * Supports the MCP protocol methods:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *
 * This is a stateless request/response handler -- transport is handled
 * by the caller (HTTP, Lambda, stdio, etc.).
 */
export class McpServer {
    private readonly name: string;
    private readonly version: string;
    private readonly toolsOverride?: Map<string, ToolHandler>;

    constructor(options: McpServerOptions) {
        this.name = options.name;
        this.version = options.version ?? "1.0.0";
        this.toolsOverride = options.tools;
    }

    private getTools(): Map<string, ToolHandler> {
        return this.toolsOverride ?? getToolRegistry();
    }

    /**
     * Handle a single JSON-RPC request and return a response.
     */
    async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { method, params, id } = request;

        try {
            switch (method) {
                case "initialize":
                    return this.handleInitialize(id);

                case "tools/list":
                    return this.handleToolsList(id);

                case "tools/call":
                    return this.handleToolsCall(id, params);

                default:
                    return {
                        jsonrpc: "2.0",
                        id,
                        error: { code: -32601, message: `Method not found: ${method}` },
                    };
            }
        } catch (err: any) {
            logger.error({ err, method }, "MCP server error");
            return {
                jsonrpc: "2.0",
                id,
                error: { code: -32603, message: err.message ?? "Internal error" },
            };
        }
    }

    private handleInitialize(id?: string | number): JsonRpcResponse {
        return {
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                serverInfo: {
                    name: this.name,
                    version: this.version,
                },
                capabilities: {
                    tools: {},
                },
            },
        };
    }

    private handleToolsList(id?: string | number): JsonRpcResponse {
        const tools = this.getTools();
        const toolList = Array.from(tools.keys()).map((name) => ({
            name,
            description: `Tool: ${name}`,
            inputSchema: { type: "object" as const },
        }));

        return {
            jsonrpc: "2.0",
            id,
            result: { tools: toolList },
        };
    }

    private async handleToolsCall(id?: string | number, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

        if (!toolName) {
            return {
                jsonrpc: "2.0",
                id,
                error: { code: -32602, message: "Missing tool name in params.name" },
            };
        }

        const tools = this.getTools();
        const tool = tools.get(toolName);

        if (!tool) {
            return {
                jsonrpc: "2.0",
                id,
                error: { code: -32602, message: `Tool not found: ${toolName}` },
            };
        }

        logger.info({ tool: toolName }, "MCP tools/call");
        const result = await tool.handler(toolArgs, null);

        return {
            jsonrpc: "2.0",
            id,
            result: {
                content: [
                    {
                        type: "text",
                        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                    },
                ],
            },
        };
    }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create an MCP server instance with the given options.
 *
 * @example
 * ```ts
 * import { createMcpServer } from "@agentrun-oss/channel-mcp";
 *
 * const server = createMcpServer({ name: "my-tools" });
 * const response = await server.handleRequest(jsonRpcRequest);
 * ```
 */
export function createMcpServer(options: McpServerOptions): McpServer {
    return new McpServer(options);
}
