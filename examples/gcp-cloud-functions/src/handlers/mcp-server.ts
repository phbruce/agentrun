// SPDX-License-Identifier: AGPL-3.0-only

// HTTP Cloud Function: MCP JSON-RPC server for Claude Code CLI integration.
// Authenticates via GitHub token and exposes RBAC-filtered tools.

import type { Request, Response } from "@google-cloud/functions-framework";
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

function jsonRpcError(id: string | number | null, code: number, message: string): any {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(id: string | number | null, result: any): any {
    return { jsonrpc: "2.0", id, result };
}

// ── Cloud Function entry point ──────────────────────────────────────────────

export async function mcpHandler(req: Request, res: Response): Promise<void> {
    try {
        await _bootstrap;

        // ── Authentication ──
        const authHeader = req.headers["authorization"] as string | undefined;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

        if (!token) {
            res.status(401).json(jsonRpcError(null, -32000,
                "Authentication required. Run: gh auth login"));
            return;
        }

        let identity;
        try {
            identity = await githubProvider.resolve(token);
        } catch (err: any) {
            const msg = err.message.includes("not a member")
                ? `${err.message}. Request access from the org admin.`
                : "GitHub token invalid or expired. Run: gh auth login";
            res.status(403).json(jsonRpcError(null, -32000, msg));
            return;
        }

        // ── Parse JSON-RPC ──
        let rpcRequest: any;
        try {
            rpcRequest = typeof req.body === "object" ? req.body : JSON.parse(req.body ?? "{}");
        } catch {
            res.status(400).json(jsonRpcError(null, -32700, "Parse error"));
            return;
        }

        const { id, method, params } = rpcRequest;

        // Create scoped clients
        let awsClients;
        try {
            awsClients = await createClientsForIdentity(identity);
        } catch (err: any) {
            console.warn("STS AssumeRole failed, using default clients:", err.message);
        }

        const registry = getToolRegistry(awsClients);

        // Filter by scope and RBAC
        const scope = (req.query.scope as string) ?? null;
        const allowedMcpTools = new Set(
            scope
                ? await getMcpToolNamesForScope(identity.role, identity.packs, scope)
                : await getMcpToolNamesForRoleWithPacks(identity.role, identity.packs),
        );

        switch (method) {
            case "initialize":
                res.status(200).json(jsonRpcResult(id, {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "agentrun", version: "0.1.0" },
                }));
                return;

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
                res.status(200).json(jsonRpcResult(id, { tools }));
                return;
            }

            case "tools/call": {
                const toolName = params?.name;
                if (!toolName) {
                    res.status(200).json(jsonRpcError(id, -32602, "Missing tool name"));
                    return;
                }
                if (!allowedMcpTools.has(toolName)) {
                    res.status(200).json(jsonRpcError(id, -32600,
                        `Tool "${toolName}" not allowed for role: ${identity.role}`));
                    return;
                }
                const tool = registry.get(toolName);
                if (!tool) {
                    res.status(200).json(jsonRpcError(id, -32601, `Tool not found: ${toolName}`));
                    return;
                }

                const result = await tool.handler(params?.arguments ?? {}, null);
                trackUsage(identity.userId, 0, 0).catch(() => {});
                res.status(200).json(jsonRpcResult(id, result));
                return;
            }

            case "notifications/initialized":
                res.status(200).json(jsonRpcResult(id, {}));
                return;

            case "agent/card": {
                const platformConfig = ensurePlatform().config;
                const catalog = await loadCatalogForPacks(identity.packs);
                const card = buildAgentCard(platformConfig, catalog);
                res.status(200).json(jsonRpcResult(id, card));
                return;
            }

            default:
                res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
                return;
        }
    } catch (e: any) {
        console.error("MCP server error:", e.message);
        res.status(500).json(jsonRpcError(null, -32603, e.message ?? "Internal error"));
    }
}
