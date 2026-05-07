// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @agentrun-ai/executor-mcp-client — MCP-client executor.
 *
 * Allows an agentrun-powered runtime to act as an MCP CLIENT against another
 * MCP server. Useful for federated catalogs (e.g., proxying tool calls to a
 * GitHub MCP server). The tool manifest declares:
 *
 *   spec:
 *     type: mcp-server
 *     mcpServer:
 *       server: <upstream-server-url>
 *       tool:   <upstream-tool-name>
 */

import type {
    Executor,
    ExecutionContext,
    ToolDef,
    ToolResult,
} from "@agentrun-ai/core";

export interface McpClientExecutorConfig {
    fetch?: typeof fetch;
    defaultServer?: string;
    timeoutMs?: number;
}

export class McpClientExecutor implements Executor {
    readonly type = "mcp-server";

    constructor(private readonly config: McpClientExecutorConfig = {}) {}

    async execute(
        tool: ToolDef,
        args: Record<string, unknown>,
        ctx: ExecutionContext,
    ): Promise<ToolResult> {
        const upstream = tool.mcpServer?.server ?? this.config.defaultServer;
        const upstreamTool = tool.mcpServer?.tool ?? tool.name;
        if (!upstream) {
            return errorResult(`Tool '${tool.name}' missing mcpServer.server (no default configured)`);
        }

        const reqBody = {
            jsonrpc: "2.0",
            id: cryptoRandomId(),
            method: "tools/call",
            params: { name: upstreamTool, arguments: args },
        };
        const fetchImpl = this.config.fetch ?? fetch;
        const timeoutMs = this.config.timeoutMs ?? 15_000;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(upstream, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(reqBody),
                signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
                return errorResult(`upstream MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
            }
            const parsed = JSON.parse(text) as {
                result?: { content?: unknown[]; isError?: boolean };
                error?: { code: number; message: string };
            };
            if (parsed.error) {
                ctx.logger.error(`[mcp-client] upstream error ${parsed.error.code}: ${parsed.error.message}`);
                return errorResult(`upstream error ${parsed.error.code}: ${parsed.error.message}`);
            }
            return {
                content: (parsed.result?.content as ToolResult["content"]) ?? [
                    { type: "text", text: "(empty)" },
                ],
                isError: parsed.result?.isError,
            };
        } catch (err) {
            const e = err as Error;
            ctx.logger.error(`[mcp-client] '${tool.name}' failed: ${e.message}`);
            return errorResult(`MCP client call failed: ${e.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
}

function cryptoRandomId(): string {
    return Math.random().toString(36).slice(2);
}

function errorResult(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

export default async function register(
    platform: { registerExecutor(e: Executor): void; logger: { info: (m: string) => void } },
    config?: unknown,
): Promise<void> {
    platform.registerExecutor(
        new McpClientExecutor((config as McpClientExecutorConfig | undefined) ?? {}),
    );
    platform.logger.info("[@agentrun-ai/executor-mcp-client] registered");
}
