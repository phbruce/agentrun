// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Response Evaluator
 *
 * Implements the "Separation of Generation from Evaluation" principle
 * from the Anthropic harness design blog post. A separate LLM call
 * evaluates the generator's response against explicit quality criteria
 * before delivering to the user.
 *
 * Key insight: "When asked to evaluate work they've produced, agents
 * tend to respond by confidently praising the work." An independent
 * evaluator tuned toward skepticism catches issues the generator misses.
 */

import { logger } from "../logger.js";
import type { GenericAgentConfig } from "./genericRunner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityCriteria {
    /** Criterion name (e.g., "factual_accuracy") */
    name: string;
    /** Weight in the final score (0-1, all weights should sum to 1) */
    weight: number;
    /** Description shown to the evaluator LLM */
    description: string;
}

export interface CriterionScore {
    name: string;
    score: number;     // 1-5
    feedback: string;  // Brief explanation
}

export interface EvaluationResult {
    /** Whether the response meets the quality threshold */
    pass: boolean;
    /** Weighted score (0-1) */
    score: number;
    /** Per-criterion scores */
    criteria: CriterionScore[];
    /** If failed, suggestion for improvement */
    suggestion?: string;
}

export interface EvaluatorConfig {
    /** Enable/disable evaluation (default: false) */
    enabled: boolean;
    /** Quality criteria with weights */
    criteria?: QualityCriteria[];
    /** Minimum weighted score to pass (default: 0.6) */
    passThreshold?: number;
    /** Maximum retry attempts if evaluation fails (default: 1) */
    maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Default criteria
// ---------------------------------------------------------------------------

export const DEFAULT_CRITERIA: QualityCriteria[] = [
    {
        name: "factual_accuracy",
        weight: 0.4,
        description: "Response is supported by tool results. No hallucinated data, URLs, dates, or statistics that weren't returned by tools.",
    },
    {
        name: "completeness",
        weight: 0.3,
        description: "Response fully answers the user's question. No missing information that was available in tool results.",
    },
    {
        name: "conciseness",
        weight: 0.2,
        description: "Response is direct and actionable. No filler phrases, unnecessary repetition, or verbose explanations.",
    },
    {
        name: "actionability",
        weight: 0.1,
        description: "User can act on the response. Links, identifiers, and next steps are included when relevant.",
    },
];

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export async function evaluateResponse(
    query: string,
    response: string,
    toolResults: string[],
    callLlm: GenericAgentConfig["callLlm"],
    config: EvaluatorConfig,
): Promise<EvaluationResult> {
    const criteria = config.criteria ?? DEFAULT_CRITERIA;
    const threshold = config.passThreshold ?? 0.6;

    const criteriaList = criteria
        .map((c, i) => `${i + 1}. ${c.name} (weight: ${c.weight}): ${c.description}`)
        .join("\n");

    const toolContext = toolResults.length > 0
        ? `\nTool results that were available:\n${toolResults.map((r, i) => `[${i + 1}] ${r.slice(0, 500)}`).join("\n")}`
        : "\nNo tools were called.";

    const result = await callLlm({
        systemPrompt: [
            "You are a response quality evaluator. You evaluate AI assistant responses against explicit criteria.",
            "Be skeptical. Look for hallucinations, incomplete answers, and unnecessary filler.",
            "Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.",
        ].join(" "),
        contents: [{
            role: "user",
            parts: [{
                text: `Evaluate this response against the criteria below.

User query: "${query}"

Assistant response:
${response}
${toolContext}

Criteria:
${criteriaList}

Respond with JSON:
{
  "scores": [
    {"name": "criterion_name", "score": <1-5>, "feedback": "brief explanation"}
  ],
  "suggestion": "if any criterion scored <= 2, suggest how to improve"
}`,
            }],
        }],
        tools: [],
    });

    const text = (result.text ?? "").trim();

    // Parse JSON response
    let parsed: { scores?: Array<{ name: string; score: number; feedback: string }>; suggestion?: string };
    try {
        // Extract JSON from potential markdown code blocks
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { scores: [] };
    } catch {
        logger.warn({ text }, "Evaluator returned non-JSON response");
        // Fail open: assume pass if evaluator can't parse
        return { pass: true, score: 1, criteria: [], suggestion: undefined };
    }

    const scores: CriterionScore[] = (parsed.scores ?? []).map((s) => ({
        name: s.name,
        score: Math.min(5, Math.max(1, s.score)),
        feedback: s.feedback || "",
    }));

    // Calculate weighted score (normalize 1-5 to 0-1)
    let weightedSum = 0;
    let totalWeight = 0;
    for (const criterion of criteria) {
        const score = scores.find((s) => s.name === criterion.name);
        if (score) {
            weightedSum += ((score.score - 1) / 4) * criterion.weight;
            totalWeight += criterion.weight;
        }
    }
    const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 1;

    const pass = finalScore >= threshold;

    logger.info(
        { score: finalScore, pass, threshold, criteria: scores.length },
        "Response evaluation complete",
    );

    return {
        pass,
        score: finalScore,
        criteria: scores,
        suggestion: pass ? undefined : parsed.suggestion,
    };
}
