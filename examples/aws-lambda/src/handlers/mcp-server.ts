// SPDX-License-Identifier: AGPL-3.0-only

// API Gateway handler: MCP JSON-RPC server for Claude Code CLI integration.
// Authenticates users via GitHub token, resolves RBAC roles, and exposes
// tools filtered by role and scope. Supports the MCP protocol methods:
// initialize, tools/list, tools/call, agent/card, notifications/initialized.

import type { APIGatewayProxyEvent, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
    GitHubTokenProvider,
    getToolRegistry,
    createClientsForIdentity,
    getMcpToolNamesForRoleWithPacks,
    getMcpToolNamesForScope,
    loadCatalogForPacks,
    bootstrapPlatform,
    ensurePlatform,
    buildAgentCard,
    trackUsage,
} from "@agentrun-ai/core";
import "../setup.js";

// ── Cold-start initialization ───────────────────────────────────────────────

const _bootstrap = bootstrapPlatform().catch((err) =>
    console.error("Platform bootstrap failed:", err.message),
);

const githubProvider = new GitHubTokenProvider();

// ── Helpers ─────────────────────────────────────────────────────────────────

function toJsonSchema(rawSchema: any): any {
    if (!rawSchema || typeof rawSchema !== "object") {
        return { type: "object", properties: {} };
    }
    if (rawSchema.type && typeof rawSchema.type === "string") {
        return rawSchema;
    }
    try {
        const zodObj = z.object(rawSchema);
        return zodToJsonSchema(zodObj, { target: "jsonSchema7" });
    } catch {
        return { type: "object", properties: {} };
    }
}

function jsonResponse(statusCode: number, body: any): APIGatewayProxyStructuredResultV2 {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

function jsonRpcError(id: string | number | null, code: number, message: string): any {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(id: string | number | null, result: any): any {
    return { jsonrpc: "2.0", id, result };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyStructuredResultV2> {
    try {
        await _bootstrap;

        // ── Authentication ──
        const authHeader = event.headers["authorization"] || event.headers["Authorization"];
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

        if (!token) {
            return jsonResponse(401, jsonRpcError(null, -32000,
                "Authentication required. Install GitHub CLI and authenticate:\n\n" +
                "  1. brew install gh\n" +
                "  2. gh auth login\n\n" +
                "AgentRun uses your GitHub token for identification.",
            ));
        }

        let identity;
        try {
            identity = await githubProvider.resolve(token);
        } catch (err: any) {
            const msg = err.message.includes("not a member")
                ? `${err.message}. Request access from the org admin.`
                : "GitHub token invalid or expired. Run: gh auth login";
            return jsonResponse(403, jsonRpcError(null, -32000, msg));
        }

        // ── Parse JSON-RPC request ──
        let rpcRequest: any;
        try {
            rpcRequest = JSON.parse(event.body ?? "{}");
        } catch {
            return jsonResponse(400, jsonRpcError(null, -32700, "Parse error"));
        }

        const { id, method, params } = rpcRequest;

        // Create scoped AWS clients via STS AssumeRole
        let awsClients;
        try {
            awsClients = await createClientsForIdentity(identity);
        } catch (err: any) {
            console.warn("STS AssumeRole failed, using default clients:", err.message);
        }

        const registry = getToolRegistry(awsClients);

        // Filter tools by scope (?scope=aws|github|jira) and RBAC role
        const scope = event.queryStringParameters?.scope ?? null;
        const allowedMcpTools = new Set(
            scope
                ? await getMcpToolNamesForScope(identity.role, identity.packs, scope)
                : await getMcpToolNamesForRoleWithPacks(identity.role, identity.packs),
        );

        // ── MCP Protocol Methods ──
        switch (method) {
            case "initialize": {
                return jsonResponse(200, jsonRpcResult(id, {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "agentrun", version: "0.1.0" },
                }));
            }

            case "tools/list": {
                const tools: any[] = [];
                for (const [name, tool] of registry) {
                    if (!allowedMcpTools.has(name)) continue;
                    tools.push({
                        name: tool.name,
                        description: (tool as any).description ?? "",
                        inputSchema: toJsonSchema((tool as any).inputSchema),
                    });
                }
                return jsonResponse(200, jsonRpcResult(id, { tools }));
            }

            case "tools/call": {
                const toolName = params?.name;
                if (!toolName) {
                    return jsonResponse(200, jsonRpcError(id, -32602, "Missing tool name"));
                }
                if (!allowedMcpTools.has(toolName)) {
                    return jsonResponse(200, jsonRpcError(id, -32600,
                        `Tool "${toolName}" not allowed for role: ${identity.role}`));
                }
                const tool = registry.get(toolName);
                if (!tool) {
                    return jsonResponse(200, jsonRpcError(id, -32601, `Tool not found: ${toolName}`));
                }

                const result = await tool.handler(params?.arguments ?? {}, null);
                trackUsage(identity.userId, 0, 0).catch(() => {});

                return jsonResponse(200, jsonRpcResult(id, result));
            }

            case "notifications/initialized": {
                return jsonResponse(200, jsonRpcResult(id, {}));
            }

            case "agent/card": {
                const platformConfig = ensurePlatform().config;
                const catalog = await loadCatalogForPacks(identity.packs);
                const card = buildAgentCard(platformConfig, catalog);
                return jsonResponse(200, jsonRpcResult(id, card));
            }

            default: {
                return jsonResponse(200, jsonRpcError(id, -32601, `Method not found: ${method}`));
            }
        }
    } catch (e: any) {
        console.error("MCP server error:", e.message);
        return jsonResponse(500, jsonRpcError(null, -32603, e.message ?? "Internal error"));
    }
}
