// SPDX-License-Identifier: AGPL-3.0-only
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { createPreToolUseHook } from "../hooks/preToolUse.js";
import { createPostToolUseHook } from "../hooks/postToolUse.js";
import { createMcpServer } from "../mcp/serverFactory.js";
import { getRoleForUser, getAllowedToolsForRole, getRoleConfig } from "../rbac/permissions.js";
import type { SkillDef } from "../catalog/types.js";
import { resolveSkillMcpTools } from "../catalog/catalog.js";
import { processDirectSkill } from "./directExecutor.js";
import { getIdentityProvider } from "../identity/index.js";
import { createClientsForIdentity } from "../mcp/clientFactory.js";
import type { ResolvedIdentity } from "../identity/types.js";
import { getModels } from "../platform/models.js";

interface ToolUsageEntry {
    tool: string;
    timestamp: string;
}

export interface AgentResult {
    answer: string;
    toolsUsed: ToolUsageEntry[];
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    error?: string;
}

export async function processInfraQuery(userQuery: string, userId: string, model?: string, isDm: boolean = false): Promise<AgentResult> {
    const startTime = Date.now();
    const toolsUsed: ToolUsageEntry[] = [];

    const identity = await getIdentityProvider().resolve(userId);
    const role = identity.role;
    const config = getRoleConfig(role);
    const allowedTools = getAllowedToolsForRole(role);

    const preToolUseHook = createPreToolUseHook(role, isDm);
    const postToolUseHook = createPostToolUseHook(toolsUsed, role, userId);

    let answer = "";
    let error: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    // Set model for this query (Lambda is single-threaded, safe to mutate env)
    if (model) {
        process.env.ANTHROPIC_MODEL = model;
    }

    // Create scoped AWS clients for this identity
    let awsClients;
    try {
        awsClients = await createClientsForIdentity(identity);
    } catch (err: any) {
        logger.warn({ err, role, userId }, "STS AssumeRole failed, falling back to default clients");
    }

    logger.info({ userId, role, allowedTools, maxTurns: config.maxTurns, maxBudgetUsd: config.maxBudgetUsd }, "AgentRun agent starting");

    try {
        for await (const message of query({
            prompt: userQuery,
            options: {
                systemPrompt: buildSystemPrompt(userId),
                pathToClaudeCodeExecutable: "/opt/nodejs/node_modules/@anthropic-ai/claude-code/cli.js",
                maxTurns: config.maxTurns,
                maxBudgetUsd: config.maxBudgetUsd,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: { "infra-tools": createMcpServer(awsClients) },
                allowedTools,
                hooks: {
                    PreToolUse: [{ hooks: [preToolUseHook] }],
                    PostToolUse: [{ hooks: [postToolUseHook] }]
                }
            }
        })) {
            const msg = message as any;
            if (msg.usage) {
                inputTokens += msg.usage.input_tokens ?? 0;
                outputTokens += msg.usage.output_tokens ?? 0;
            }
            if (message.type === "result") {
                if (message.subtype === "success") {
                    answer = message.result ?? "";
                } else {
                    error = msg.error ?? msg.errors?.join("; ") ?? `Agent stopped: ${message.subtype}`;
                }
            }
        }
    } catch (err: any) {
        logger.error({ err, userQuery, role, userId }, "Agent execution failed");
        error = err.message ?? "Unknown agent error";
    }

    return {
        answer: answer || error || "No response from agent",
        toolsUsed,
        durationMs: Date.now() - startTime,
        inputTokens,
        outputTokens,
        error
    };
}

export async function processSkill(skill: SkillDef, args: string, userId: string, model?: string, isDm: boolean = false): Promise<AgentResult> {
    if (skill.mode === "direct") {
        return processDirectSkill(skill, args, userId, model ?? getModels().defaultModel);
    }

    const startTime = Date.now();
    const toolsUsed: ToolUsageEntry[] = [];

    const identity = await getIdentityProvider().resolve(userId);
    const role = identity.role;
    const allowedTools = resolveSkillMcpTools(skill);

    const preToolUseHook = createPreToolUseHook(role, isDm);
    const postToolUseHook = createPostToolUseHook(toolsUsed, role, userId);

    let answer = "";
    let error: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    if (model) {
        process.env.ANTHROPIC_MODEL = model;
    }

    const prompt = skill.args ? skill.prompt.replace(/\{\{args\}\}/g, args) : skill.prompt;

    // Create scoped AWS clients for this identity
    let awsClients;
    try {
        awsClients = await createClientsForIdentity(identity);
    } catch (err: any) {
        logger.warn({ err, role, userId }, "STS AssumeRole failed, falling back to default clients");
    }

    logger.info({ userId, role, skill: skill.command, args, allowedTools, maxTurns: skill.maxTurns, maxBudgetUsd: skill.maxBudgetUsd }, "AgentRun skill starting");

    try {
        for await (const message of query({
            prompt,
            options: {
                systemPrompt: buildSystemPrompt(userId),
                pathToClaudeCodeExecutable: "/opt/nodejs/node_modules/@anthropic-ai/claude-code/cli.js",
                maxTurns: skill.maxTurns,
                maxBudgetUsd: skill.maxBudgetUsd,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: { "infra-tools": createMcpServer(awsClients) },
                allowedTools,
                hooks: {
                    PreToolUse: [{ hooks: [preToolUseHook] }],
                    PostToolUse: [{ hooks: [postToolUseHook] }]
                }
            }
        })) {
            const msg = message as any;
            if (msg.usage) {
                inputTokens += msg.usage.input_tokens ?? 0;
                outputTokens += msg.usage.output_tokens ?? 0;
            }
            if (message.type === "result") {
                if (message.subtype === "success") {
                    answer = message.result ?? "";
                } else {
                    error = msg.error ?? msg.errors?.join("; ") ?? `Agent stopped: ${message.subtype}`;
                }
            }
        }
    } catch (err: any) {
        logger.error({ err, skill: skill.command, role, userId }, "Skill execution failed");
        error = err.message ?? "Unknown agent error";
    }

    return {
        answer: answer || error || "No response from agent",
        toolsUsed,
        durationMs: Date.now() - startTime,
        inputTokens,
        outputTokens,
        error
    };
}
