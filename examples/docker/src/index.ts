// SPDX-License-Identifier: AGPL-3.0-only

// Dockerized Fastify server for AgentRun.
// Serves both Slack events and MCP endpoints. Backed by PostgreSQL (sessions, RAG)
// and Redis (event dedup cache). All processing happens in-process.

import "dotenv/config";
import Fastify from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
    processRequest,
    bootstrapPlatform,
    loadCatalogForPacks,
    setCatalog,
    GitHubTokenProvider,
    getToolRegistry,
    createClientsForIdentity,
    getMcpToolNamesForRoleWithPacks,
    getMcpToolNamesForScope,
    ensurePlatform,
    buildAgentCard,
    trackUsage,
} from "@agentrun-oss/core";
import type { ChannelContext } from "@agentrun-oss/core";
import { SlackChannelAdapter, addReaction } from "@agentrun-oss/channel-slack";
import "./setup.js";

// ── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const PACKS = (process.env.AGENTRUN_PACKS ?? "default").split(",");

// ── Bootstrap ───────────────────────────────────────────────────────────────

const _bootstrap = bootstrapPlatform()
    .then(() => {
        console.info("Loading catalog for packs:", PACKS);
        return loadCatalogForPacks(PACKS);
    })
    .then((catalog) => {
        console.info(
            `Catalog loaded — tools=${catalog.tools.size} ` +
            `workflows=${catalog.workflows.size} skills=${catalog.skills.size}`,
        );
        setCatalog(catalog);
    })
    .catch((err) => {
        console.error("Platform bootstrap failed:", err?.message);
    });

const slackAdapter = new SlackChannelAdapter();
const githubProvider = new GitHubTokenProvider();

// ── Helpers ─────────────────────────────────────────────────────────────────

// In-memory dedup (consider Redis-based dedup for multi-replica deployments)
const recentEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function isDuplicate(eventId: string): boolean {
    const now = Date.now();
    for (const [key, ts] of recentEvents) {
        if (now - ts > DEDUP_TTL_MS) recentEvents.delete(key);
    }
    if (recentEvents.has(eventId)) return true;
    recentEvents.set(eventId, now);
    return false;
}

function cleanMentionText(text: string): string {
    return text.replace(/<@[^>]+>\s*/g, "").trim();
}

function enqueue(task: () => Promise<void>): void {
    task().catch((err) => console.error("Background task failed:", err.message));
}

function toJsonSchema(rawSchema: any): any {
    if (!rawSchema || typeof rawSchema !== "object") {
        return { type: "object", properties: {} };
    }
    if (rawSchema.type && typeof rawSchema.type === "string") {
        return rawSchema;
    }
    try {
        return zodToJsonSchema(z.object(rawSchema), { target: "jsonSchema7" });
    } catch {
        return { type: "object", properties: {} };
    }
}

// ── Slack types ─────────────────────────────────────────────────────────────

interface SlackEvent {
    type: string;
    subtype?: string;
    user: string;
    text: string;
    channel: string;
    channel_type?: string;
    ts: string;
    thread_ts?: string;
    event_ts: string;
    bot_id?: string;
}

interface SlackEventPayload {
    type: string;
    challenge?: string;
    event?: SlackEvent;
    event_id?: string;
}

interface SlackInteractionPayload {
    type: string;
    user: { id: string };
    channel?: { id: string };
    message?: { ts: string; thread_ts?: string };
    actions?: Array<{
        action_id: string;
        type: string;
        value?: string;
        selected_option?: { value: string; text?: { text: string } };
    }>;
    response_url?: string;
    container?: { message_ts: string; channel_id: string; thread_ts?: string };
}

function extractActionText(payload: SlackInteractionPayload): string | null {
    const action = payload.actions?.[0];
    if (!action) return null;
    if (action.action_id.startsWith("skill_") && action.value) return action.value;
    if (action.action_id.startsWith("uc_select_") && action.selected_option) {
        return action.selected_option.text?.text
            ?? action.selected_option.value.replace(/^wf:/, "").replace(/-/g, " ");
    }
    return null;
}

async function processQuery(params: {
    userId: string;
    channelId: string;
    text: string;
    threadTs: string;
    messageTs: string;
    responseUrl?: string;
}): Promise<void> {
    const { userId, channelId, text, threadTs, messageTs, responseUrl } = params;
    const isDm = channelId?.startsWith("D") ?? false;

    const ctx: ChannelContext = {
        requestId: crypto.randomUUID(),
        sessionId: threadTs
            ? `slack:${channelId}#${threadTs}`
            : `slack:${channelId}#${messageTs}`,
        userId,
        source: "slack",
        query: text,
        isPrivate: isDm,
        responseUrl,
        meta: {
            channelId: channelId ?? "",
            threadTs: threadTs ?? "",
            messageTs: messageTs ?? "",
        },
    };

    await processRequest({ ctx, adapter: slackAdapter });
}

// ── Server ──────────────────────────────────────────────────────────────────

const app = Fastify({ logger: true });

// Health check — used by Docker HEALTHCHECK and load balancers
app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

// ── Slack events + interactions ──

app.post("/events", async (request, reply) => {
    await _bootstrap;

    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body);

    // Slack interactions
    if (typeof request.body === "string" && request.body.startsWith("payload=")) {
        let payload: SlackInteractionPayload;
        try {
            const decoded = decodeURIComponent(request.body.replace(/^payload=/, "").replace(/\+/g, " "));
            payload = JSON.parse(decoded);
        } catch {
            return reply.code(200).send({ ok: true });
        }
        if (payload.type !== "block_actions") return reply.code(200).send({ ok: true });

        const text = extractActionText(payload);
        if (!text) return reply.code(200).send({ ok: true });

        const userId = payload.user.id;
        const channelId = payload.channel?.id || payload.container?.channel_id || "";
        const messageTs = payload.message?.ts || payload.container?.message_ts || "";
        const threadTs = payload.message?.thread_ts || payload.container?.thread_ts || messageTs;

        enqueue(() => processQuery({ userId, channelId, text, threadTs, messageTs, responseUrl: payload.response_url }));
        return reply.code(200).send({ ok: true });
    }

    // Slack Events API
    const body: SlackEventPayload = typeof request.body === "object" ? request.body as SlackEventPayload : JSON.parse(rawBody);

    if (body.type === "url_verification") {
        return reply.code(200).send({ challenge: body.challenge });
    }

    if (body.type !== "event_callback" || !body.event) {
        return reply.code(200).send({ ok: true });
    }

    const slackEvent = body.event;
    const isDm = slackEvent.type === "message" && slackEvent.channel_type === "im";
    if (slackEvent.type !== "app_mention" && !isDm) {
        return reply.code(200).send({ ok: true });
    }
    if (slackEvent.bot_id || slackEvent.subtype) {
        return reply.code(200).send({ ok: true });
    }
    if (body.event_id && isDuplicate(body.event_id)) {
        return reply.code(200).send({ ok: true });
    }

    const text = slackEvent.type === "app_mention"
        ? cleanMentionText(slackEvent.text)
        : (slackEvent.text || "").trim();
    if (!text) return reply.code(200).send({ ok: true });

    const threadTs = slackEvent.thread_ts || slackEvent.ts;

    addReaction(slackEvent.channel, slackEvent.ts, "eyes").catch(() => {});
    enqueue(() => processQuery({
        userId: slackEvent.user,
        channelId: slackEvent.channel,
        text,
        threadTs,
        messageTs: slackEvent.ts,
    }));

    return reply.code(200).send({ ok: true });
});

// ── MCP JSON-RPC ──

app.post("/mcp", async (request, reply) => {
    await _bootstrap;

    const authHeader = request.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
        return reply.code(401).send({
            jsonrpc: "2.0", id: null,
            error: { code: -32000, message: "Authentication required. Run: gh auth login" },
        });
    }

    let identity;
    try {
        identity = await githubProvider.resolve(token);
    } catch (err: any) {
        const msg = err.message.includes("not a member")
            ? `${err.message}. Request access from the org admin.`
            : "GitHub token invalid or expired. Run: gh auth login";
        return reply.code(403).send({
            jsonrpc: "2.0", id: null,
            error: { code: -32000, message: msg },
        });
    }

    const rpcRequest = request.body as any;
    const { id, method, params } = rpcRequest;

    let awsClients;
    try {
        awsClients = await createClientsForIdentity(identity);
    } catch {
        // Fall back to default clients
    }

    const registry = getToolRegistry(awsClients);

    const scope = (request.query as any)?.scope ?? null;
    const allowedMcpTools = new Set(
        scope
            ? await getMcpToolNamesForScope(identity.role, identity.packs, scope)
            : await getMcpToolNamesForRoleWithPacks(identity.role, identity.packs),
    );

    switch (method) {
        case "initialize":
            return reply.send({
                jsonrpc: "2.0", id,
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "agentrun", version: "0.1.0" },
                },
            });

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
            return reply.send({ jsonrpc: "2.0", id, result: { tools } });
        }

        case "tools/call": {
            const toolName = params?.name;
            if (!toolName) {
                return reply.send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } });
            }
            if (!allowedMcpTools.has(toolName)) {
                return reply.send({ jsonrpc: "2.0", id, error: { code: -32600, message: `Tool "${toolName}" not allowed for role: ${identity.role}` } });
            }
            const tool = registry.get(toolName);
            if (!tool) {
                return reply.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
            }
            const result = await tool.handler(params?.arguments ?? {}, null);
            trackUsage(identity.userId, 0, 0).catch(() => {});
            return reply.send({ jsonrpc: "2.0", id, result });
        }

        case "notifications/initialized":
            return reply.send({ jsonrpc: "2.0", id, result: {} });

        case "agent/card": {
            const platformConfig = ensurePlatform().config;
            const catalog = await loadCatalogForPacks(identity.packs);
            const card = buildAgentCard(platformConfig, catalog);
            return reply.send({ jsonrpc: "2.0", id, result: card });
        }

        default:
            return reply.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
});

// ── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
    console.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Start ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
    try {
        await app.listen({ port: PORT, host: HOST });
        console.info(`AgentRun server listening on ${HOST}:${PORT}`);
        console.info(`  Slack events: http://${HOST}:${PORT}/events`);
        console.info(`  MCP endpoint: http://${HOST}:${PORT}/mcp`);
        console.info(`  Health check: http://${HOST}:${PORT}/health`);
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
}

start();
