// SPDX-License-Identifier: AGPL-3.0-only
import type { ProtocolAdapter, AgentCard, TaskRequest, TaskResponse, TaskStatus } from "./types.js";

/**
 * MCP Protocol Adapter — skeleton for future StreamableHTTP / OAuth 2.1 evolution.
 *
 * Today, AgentRun serves MCP via JSON-RPC over HTTP with API key auth.
 * This adapter will evolve as MCP spec adds:
 *   - StreamableHTTP transport (replacing SSE)
 *   - OAuth 2.1 authorization (replacing bearer tokens)
 *   - Resource Indicators (RFC 9728)
 *   - MCP Apps (interactive UI components)
 */
export class McpProtocolAdapter implements ProtocolAdapter {
    readonly name = "mcp";
    readonly protocolVersion: string;

    constructor(version: string = "2024-11-05") {
        this.protocolVersion = version;
    }

    async negotiate(_agentCard: AgentCard): Promise<boolean> {
        // Future: negotiate capabilities with remote MCP server
        // Today: MCP doesn't have agent-to-agent negotiation
        throw new Error("MCP agent negotiation not yet supported. See A2A protocol for agent-to-agent communication.");
    }

    async submitTask(_task: TaskRequest): Promise<TaskResponse> {
        // Future: map A2A TaskRequest to MCP tools/call JSON-RPC
        throw new Error("MCP task submission not yet supported. Use JSON-RPC tools/call directly.");
    }

    async getTaskStatus(_taskId: string): Promise<TaskStatus> {
        // Future: map to MCP streaming task status
        throw new Error("MCP task status not yet supported. MCP operations are synchronous today.");
    }
}
