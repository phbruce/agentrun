// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model Router
 *
 * Selects the optimal LLM model for a query based on:
 *   1. Query complexity (simple → fast, complex → advanced)
 *   2. Role's allowed models (RBAC constraint)
 *   3. Cost optimization (cheapest model that meets capability requirement)
 *
 * The router is model-agnostic — it works with any LLM provider.
 * Model definitions come from PlatformConfig.spec.models.
 */

import type { ModelDef, ModelCapability } from "../platform/types.js";
import { logger } from "../logger.js";

// Re-export ModelDef for convenience
export type { ModelDef } from "../platform/types.js";

export interface ModelSelection {
    /** Logical model name (key from spec.models) */
    name: string;
    /** Full model definition */
    model: ModelDef;
    /** Why this model was selected */
    reason: string;
}

export type QueryComplexity = "simple" | "moderate" | "complex";

// Complexity → minimum capability mapping
const COMPLEXITY_TO_CAPABILITY: Record<QueryComplexity, ModelCapability> = {
    simple: "fast",
    moderate: "balanced",
    complex: "advanced",
};

// Capability hierarchy (higher index = more capable)
const CAPABILITY_RANK: Record<ModelCapability, number> = {
    fast: 0,
    balanced: 1,
    advanced: 2,
};

/**
 * Classify query complexity using heuristics.
 * This is a fast, zero-cost classification (no LLM call).
 */
export function classifyComplexity(query: string): QueryComplexity {
    const lower = query.toLowerCase();
    const wordCount = query.split(/\s+/).length;

    // Complex indicators
    const complexPatterns = [
        /analy[sz]/i,           // analyze, analyse
        /compar/i,              // compare, comparison
        /architect/i,           // architecture
        /design/i,              // design
        /refactor/i,            // refactoring
        /impact/i,              // impact analysis
        /strategy/i,            // strategy
        /migrat/i,              // migration
        /optimi[sz]/i,          // optimize
        /trade.?off/i,          // trade-off
        /pros?\s+(and|e)\s+cons?/i, // pros and cons
        /explain.*why/i,        // explain why
        /root\s+cause/i,        // root cause
        /debug/i,               // debugging
        /review.*code/i,        // code review
        /suggest.*improv/i,     // suggest improvements
    ];

    // Simple indicators
    const simplePatterns = [
        /^(list|show|get|fetch|find|search|busca|mostr|qual|quais|cuantos|cuales)/i,
        /^(status|estado)/i,
        /^(what is|what are|o que|que es)/i,
        /sprint/i,
        /cards?$/i,
        /tarefas?$/i,
        /issues?$/i,
        /pipeline/i,
        /merge.?request/i,
    ];

    if (complexPatterns.some(p => p.test(lower)) || wordCount > 40) {
        return "complex";
    }

    if (simplePatterns.some(p => p.test(lower)) || wordCount <= 8) {
        return "simple";
    }

    return "moderate";
}

/**
 * Get available models for a role, filtered by RBAC.
 * Returns models sorted by capability (ascending) then cost (ascending).
 */

export function getModelsForRole(
    allModels: Record<string, ModelDef>,
    allowedModelNames?: string[],
): Array<{ name: string; model: ModelDef }> {
    const allowedNames = allowedModelNames;

    const entries = Object.entries(allModels)
        .filter(([name]) => !allowedNames || allowedNames.length === 0 || allowedNames.includes(name))
        .map(([name, model]) => ({ name, model }))
        .sort((a, b) => {
            // Sort by capability first, then by input cost
            const capDiff = CAPABILITY_RANK[a.model.capability] - CAPABILITY_RANK[b.model.capability];
            if (capDiff !== 0) return capDiff;
            return a.model.inputCostPer1kTokens - b.model.inputCostPer1kTokens;
        });

    return entries;
}

/**
 * Select the best model for a query.
 *
 * Strategy: pick the cheapest model whose capability meets the query complexity.
 * If no model meets the requirement, pick the most capable available.
 */
export function selectModel(
    query: string,
    allModels: Record<string, ModelDef>,
    allowedModelNames?: string[],
): ModelSelection {
    const complexity = classifyComplexity(query);
    const minCapability = COMPLEXITY_TO_CAPABILITY[complexity];
    const minRank = CAPABILITY_RANK[minCapability];

    const available = getModelsForRole(allModels, allowedModelNames);

    if (available.length === 0) {
        throw new Error("No models available for this role. Check spec.models and role.models configuration.");
    }

    // Find cheapest model that meets the minimum capability
    const eligible = available.filter(m => CAPABILITY_RANK[m.model.capability] >= minRank);

    if (eligible.length > 0) {
        const selected = eligible[0]; // Already sorted by capability then cost
        logger.info({
            model: selected.name,
            complexity,
            capability: selected.model.capability,
        }, "Model selected");

        return {
            name: selected.name,
            model: selected.model,
            reason: `${complexity} query → ${selected.model.capability} model (${selected.name})`,
        };
    }

    // No model meets requirement → use the most capable available
    const fallback = available[available.length - 1];
    logger.info({
        model: fallback.name,
        complexity,
        capability: fallback.model.capability,
        fallback: true,
    }, "Model selected (fallback — no model meets complexity requirement)");

    return {
        name: fallback.name,
        model: fallback.model,
        reason: `${complexity} query → best available: ${fallback.name} (${fallback.model.capability})`,
    };
}
