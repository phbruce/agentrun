// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "./logger.js";
import { processInfraQuery, processSkill } from "./agent/agentRunner.js";
import { classifyQuery } from "./classifier.js";
import { getRoleForUser } from "./rbac/permissions.js";
import { getSkillByCommand } from "./catalog/catalog.js";
import { trackUsage } from "./usage/tracker.js";
import { saveMessage, getHistory, buildPromptWithHistory } from "./session/store.js";
import type { ChannelContext, ChannelAdapter } from "./channels/types.js";
import type { IdentitySource, Role } from "./rbac/types.js";
import type { SkillDef } from "./catalog/types.js";
import { PlatformRegistry } from "./platform/registry.js";
import { getModels } from "./platform/models.js";

const COMPLEX_KEYWORDS = [
    "comparar", "comparação", "analisar", "análise", "investigar",
    "por que", "porque", "diagnosticar", "debug", "problema",
    "lento", "latência", "performance", "otimizar",
    "todos", "todas", "completo", "detalhado",
    "diferença", "relação", "entre",
];

function getComplexModelRoles(): Set<string> {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const roles = registry.config.spec.roles;
            // Roles with infra:write or infra:admin get the complex model
            const result = new Set<string>();
            for (const [role, def] of Object.entries(roles)) {
                if (def.actions.includes("infra:write") || def.actions.includes("infra:admin")) {
                    result.add(role);
                }
            }
            return result;
        }
    } catch { /* not configured */ }
    return new Set(["tech_lead", "platform"]);
}

function pickModel(query: string, userId: string, source: IdentitySource): string {
    const role = getRoleForUser(userId, source);
    const models = getModels();
    const complexRoles = getComplexModelRoles();

    if (!complexRoles.has(role)) {
        return models.defaultModel;
    }

    const q = query.toLowerCase();
    const isLong = q.length > 80;
    const isComplex = COMPLEX_KEYWORDS.some((kw) => q.includes(kw));
    return isLong || isComplex ? models.complexModel : models.defaultModel;
}

function parseSkillCommand(text: string, userId: string, source: IdentitySource): { skill: SkillDef; args: string } | null {
    const trimmed = text.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const command = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

    const skill = getSkillByCommand(command);
    if (!skill) return null;

    if (skill.args && !args) return null;

    const role = getRoleForUser(userId, source);
    if (!skill.allowedRoles.includes(role)) return null;

    return { skill, args };
}

export interface ProcessRequestInput {
    ctx: ChannelContext;
    adapter: ChannelAdapter;
}

export async function processRequest({ ctx, adapter }: ProcessRequestInput): Promise<void> {
    logger.info({ userId: ctx.userId, source: ctx.source, query: ctx.query, sessionId: ctx.sessionId }, "Orchestrator processing request");

    await adapter.onProcessingStart(ctx);

    try {
        // Greeting short-circuit
        if (classifyQuery(ctx.query) === "greeting") {
            logger.info({ userId: ctx.userId }, "Orchestrator greeting — skipping agent");
            await adapter.deliverGreeting(ctx);
            await adapter.onProcessingComplete(ctx);
            return;
        }

        // Skill short-circuit
        const skillMatch = parseSkillCommand(ctx.query, ctx.userId, ctx.source);
        if (skillMatch) {
            logger.info({ userId: ctx.userId, skill: skillMatch.skill.command, args: skillMatch.args }, "Orchestrator skill matched");

            const models = getModels();
            const result = await processSkill(skillMatch.skill, skillMatch.args, ctx.userId, ctx.source, models.defaultModel, ctx.isPrivate);

            // Session management
            await saveMessage(ctx.sessionId, Date.now().toString(), "user", ctx.query, ctx.userId);
            saveMessage(ctx.sessionId, `${Date.now()}.1`, "assistant", result.answer, "bot").catch((err) =>
                logger.warn({ error: err.message }, "Orchestrator session save failed"),
            );

            trackUsage(ctx.userId, result.inputTokens, result.outputTokens).catch((err) =>
                logger.warn({ error: err.message }, "Orchestrator usage tracking failed"),
            );

            await adapter.deliverResult(ctx, result);
            await adapter.onProcessingComplete(ctx);

            logger.info(
                { userId: ctx.userId, skill: skillMatch.skill.command, durationMs: result.durationMs, toolsUsed: result.toolsUsed.length, error: !!result.error },
                "Orchestrator skill completed",
            );
            return;
        }

        // General query
        const model = pickModel(ctx.query, ctx.userId, ctx.source);
        logger.info({ userId: ctx.userId, role: getRoleForUser(ctx.userId, ctx.source), model }, "Orchestrator model selected");

        // Build prompt with session history
        let prompt = ctx.query;
        const history = await getHistory(ctx.sessionId);

        if (history.length > 0) {
            logger.info({ sessionId: ctx.sessionId, historyLength: history.length }, "Orchestrator session loaded");
            prompt = buildPromptWithHistory(history, ctx.query);
        }

        await saveMessage(ctx.sessionId, Date.now().toString(), "user", ctx.query, ctx.userId);

        const result = await processInfraQuery(prompt, ctx.userId, ctx.source, model, ctx.isPrivate);

        // Save assistant response
        saveMessage(ctx.sessionId, `${Date.now()}.1`, "assistant", result.answer, "bot").catch((err) =>
            logger.warn({ error: err.message }, "Orchestrator session save failed"),
        );

        trackUsage(ctx.userId, result.inputTokens, result.outputTokens).catch((err) =>
            logger.warn({ error: err.message }, "Orchestrator usage tracking failed"),
        );

        await adapter.deliverResult(ctx, result);
        await adapter.onProcessingComplete(ctx);

        logger.info(
            { userId: ctx.userId, sessionId: ctx.sessionId, durationMs: result.durationMs, toolsUsed: result.toolsUsed.length, error: !!result.error },
            "Orchestrator query completed",
        );
    } catch (error: any) {
        logger.error({ error: error.message, userId: ctx.userId }, "Orchestrator process failed");
        await adapter.deliverError(ctx, error.message ?? "Unknown error");
        throw error;
    }
}
