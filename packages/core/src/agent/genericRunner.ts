// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generic Agent Runner
 *
 * Model-agnostic agent runner that uses the LlmProvider interface
 * for multi-turn tool-use conversations. Works with any LLM backend
 * that supports function calling (Gemini, Claude, GPT, etc.)
 *
 * Unlike agentRunner.ts (which depends on Claude Agent SDK subprocess),
 * this runner calls the LLM API directly via the registered provider.
 */

import { logger } from "../logger.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { getRoleForUser, getAllowedToolsForRole } from "../rbac/permissions.js";
import type { IdentitySource } from "../rbac/types.js";
import type { AgentResult } from "./agentRunner.js";
import { getToolDefsForRole, getToolDefsForUseCase, matchUseCaseFromQuery, getUseCasesForRole, getCatalog, getKnowledgeBasesForRole } from "../catalog/catalog.js";
import type { UseCaseDef } from "../catalog/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
}

export interface FunctionResponse {
    name: string;
    response: { result?: string; error?: string };
}

export interface GenericAgentConfig {
    /** Max rounds of tool use (default: 5) */
    maxRounds?: number;
    /** Tool schemas for function declarations */
    toolSchemas?: Record<string, object>;
    /** Custom system prompt override (if not provided, uses buildSystemPrompt) */
    systemPromptOverride?: string;
    /** Use LLM to classify queries when keyword matching is ambiguous (default: true) */
    useLlmRouting?: boolean;
    /** Response evaluator configuration (opt-in, default: disabled) */
    evaluator?: import("./evaluator.js").EvaluatorConfig;
    /** Tool executor function */
    executeTool: (toolName: string, args: Record<string, unknown>) => Promise<string>;
    /** LLM function calling implementation */
    callLlm: (options: {
        systemPrompt: string;
        contents: Array<{ role: string; parts: unknown[] }>;
        tools: FunctionDeclaration[];
    }) => Promise<{
        text?: string;
        functionCalls?: FunctionCall[];
        inputTokens?: number;
        outputTokens?: number;
    }>;
}

// ---------------------------------------------------------------------------
// LLM-based query classification (layer 2 of two-layer routing)
// ---------------------------------------------------------------------------

interface ClassifyResult {
    useCase: UseCaseDef | null;
    inputTokens: number;
    outputTokens: number;
}

async function classifyWithLlm(
    query: string,
    useCases: UseCaseDef[],
    callLlm: GenericAgentConfig["callLlm"],
): Promise<ClassifyResult> {
    const options = useCases.map(uc => `- ${uc.name}: ${uc.description}`).join("\n");

    const result = await callLlm({
        systemPrompt: [
            "You are a query classifier.",
            "Given a user query and a list of available operations, respond with ONLY the operation name that best matches.",
            "If no operation is a good match, respond with \"none\".",
            "Do not explain your reasoning. Just the name.",
        ].join(" "),
        contents: [{
            role: "user",
            parts: [{ text: `Operations:\n${options}\n\nQuery: "${query}"\n\nBest match:` }],
        }],
        tools: [],
    });

    const answer = (result.text ?? "").trim().toLowerCase();
    const matched = answer === "none"
        ? null
        : useCases.find(uc => answer.includes(uc.name.toLowerCase())) ?? null;

    return {
        useCase: matched,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function processGenericQuery(
    userQuery: string,
    userId: string,
    source: IdentitySource,
    config: GenericAgentConfig,
    history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<AgentResult> {
    const startTime = Date.now();
    const toolsUsed: Array<{ tool: string; timestamp: string }> = [];
    let inputTokens = 0;
    let outputTokens = 0;
    const maxRounds = config.maxRounds ?? 5;

    const role = getRoleForUser(userId, source);

    // Build system prompt from config (persona, environment, resources, catalog)
    let systemPrompt = config.systemPromptOverride ?? buildSystemPrompt(userId, source);

    // -----------------------------------------------------------------------
    // Two-layer routing: keywords (fast) → LLM classification (smart)
    // -----------------------------------------------------------------------
    const keywordMatch = matchUseCaseFromQuery(userQuery, role);
    let matchedUseCase: UseCaseDef | null = null;

    if (keywordMatch.confident) {
        // Layer 1: high-confidence keyword match → skip LLM
        matchedUseCase = keywordMatch.useCase;
        logger.info({ useCase: matchedUseCase?.name, score: keywordMatch.score }, "Use case matched by keywords");
    } else if (config.useLlmRouting !== false) {
        // Layer 2: ambiguous → ask LLM to classify
        const useCases = getUseCasesForRole(role);
        if (useCases.length > 0) {
            try {
                const classResult = await classifyWithLlm(userQuery, useCases, config.callLlm);
                matchedUseCase = classResult.useCase;
                inputTokens += classResult.inputTokens;
                outputTokens += classResult.outputTokens;
                if (matchedUseCase) {
                    logger.info({ useCase: matchedUseCase.name }, "Use case classified by LLM");
                }
            } catch (err) {
                logger.warn({ err }, "LLM classification failed, falling back to keyword match");
                matchedUseCase = keywordMatch.useCase;
            }
        }
    } else {
        // LLM routing disabled → use keyword candidate even if low confidence
        matchedUseCase = keywordMatch.useCase;
    }

    if (matchedUseCase) {
        systemPrompt += `\n\n## Routing Context\nMatched operation: ${matchedUseCase.name} — ${matchedUseCase.description}\n${matchedUseCase.template}`;
    }

    // -----------------------------------------------------------------------
    // Build function declarations
    // -----------------------------------------------------------------------
    const declarations: FunctionDeclaration[] = [];
    const catalog = getCatalog();

    if (config.toolSchemas) {
        // Explicit schemas: filter by RBAC, enrich descriptions from catalog
        const allowedTools = getAllowedToolsForRole(role);
        for (const [name, schema] of Object.entries(config.toolSchemas)) {
            if (allowedTools.length > 0 && !allowedTools.includes(name)) continue;
            const catalogTool = catalog.tools.get(name);
            declarations.push({
                name: name.replace(/-/g, "_"),
                description: catalogTool?.description ?? `Tool: ${name}`,
                parameters: schema as Record<string, unknown>,
            });
        }
    } else {
        // Auto-derive from catalog with use-case routing
        const toolDefs = matchedUseCase
            ? getToolDefsForUseCase(matchedUseCase.name)
            : getToolDefsForRole(role);

        for (const tool of toolDefs) {
            declarations.push({
                name: tool.name.replace(/-/g, "_"),
                description: tool.description,
                parameters: {},
            });
        }

        // Include workflows-with-steps as callable tools (they have input schemas)
        const useCaseNames = matchedUseCase
            ? [matchedUseCase.name]
            : [...catalog.useCases.keys()];

        for (const ucName of useCaseNames) {
            const uc = catalog.useCases.get(ucName);
            if (!uc) continue;
            for (const wfName of uc.workflows) {
                const wf = catalog.workflows.get(wfName);
                if (!wf?.steps || wf.steps.length === 0) continue;
                declarations.push({
                    name: wf.name.replace(/-/g, "_"),
                    description: wf.description,
                    parameters: wf.inputSchema ? {
                        type: "object",
                        properties: wf.inputSchema.properties ?? {},
                        required: wf.inputSchema.required ?? [],
                    } : {},
                });
            }
        }
    }

    // Auto-include knowledge_search tool when KBs exist and not already declared
    const kbs = getKnowledgeBasesForRole(role);
    const hasKbTool = declarations.some(d => d.name === "knowledge_search");
    if (kbs.length > 0 && !hasKbTool) {
        declarations.push({
            name: "knowledge_search",
            description: "Search the knowledge base for documentation, architecture, patterns, and team knowledge. Use when the user asks about topics covered by the available knowledge bases.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query for the knowledge base" },
                    top_k: { type: "number", description: "Number of results to return (default: 5)" },
                },
                required: ["query"],
            },
        });
    }

    // Build conversation contents from history
    const contents: Array<{ role: string; parts: unknown[] }> = [];
    for (const msg of history) {
        contents.push({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
        });
    }
    contents.push({ role: "user", parts: [{ text: userQuery }] });

    // Track previous tool calls to detect loops
    const previousCalls = new Map<string, string>();

    // Multi-turn tool use loop
    for (let round = 0; round < maxRounds; round++) {
        const result = await config.callLlm({
            systemPrompt,
            contents,
            tools: declarations,
        });

        inputTokens += result.inputTokens ?? 0;
        outputTokens += result.outputTokens ?? 0;

        // No function calls -- evaluate and return text
        if (!result.functionCalls || result.functionCalls.length === 0) {
            let answer = result.text ?? "No response.";
            let qualityScore: number | undefined;
            let evaluationCriteria: Array<{ name: string; score: number }> | undefined;

            // Run evaluator if enabled
            if (config.evaluator?.enabled) {
                const { evaluateResponse } = await import("./evaluator.js");
                const toolResultTexts = [...previousCalls.values()];
                const evalResult = await evaluateResponse(
                    userQuery, answer, toolResultTexts, config.callLlm, config.evaluator,
                );
                inputTokens += 200; // approximate evaluator cost
                outputTokens += 100;
                qualityScore = evalResult.score;
                evaluationCriteria = evalResult.criteria.map(c => ({ name: c.name, score: c.score }));

                // If failed and retries available, feed suggestion back and re-generate
                if (!evalResult.pass && evalResult.suggestion && round < maxRounds - 1) {
                    logger.info({ score: evalResult.score, suggestion: evalResult.suggestion }, "Evaluator rejected response, retrying");
                    contents.push({ role: "model", parts: [{ text: answer }] });
                    contents.push({ role: "user", parts: [{ text: `The response quality was insufficient. ${evalResult.suggestion}. Please improve your answer.` }] });
                    continue; // Re-enter the loop for another LLM call
                }
            }

            return {
                answer,
                toolsUsed,
                durationMs: Date.now() - startTime,
                inputTokens,
                outputTokens,
                qualityScore,
                evaluationCriteria,
            };
        }

        // Add model response to contents
        contents.push({
            role: "model",
            parts: result.functionCalls.map((fc) => ({ functionCall: fc })),
        });

        // Execute tool calls
        const functionResponses: unknown[] = [];
        for (const fc of result.functionCalls) {
            const toolName = fc.name.replace(/_/g, "-");
            toolsUsed.push({ tool: toolName, timestamp: new Date().toISOString() });

            logger.info({ tool: toolName, round }, "Generic agent calling tool");

            // Detect duplicate calls (same tool + same args = loop)
            const callKey = `${toolName}:${JSON.stringify(fc.args)}`;
            const cachedResult = previousCalls.get(callKey);

            if (cachedResult) {
                logger.warn({ tool: toolName, round }, "Duplicate tool call detected, returning cached result");
                functionResponses.push({
                    functionResponse: { name: fc.name, response: { result: `[Same result as before — data has not changed]\n${cachedResult.slice(0, 2000)}` } },
                });
                continue;
            }

            try {
                const toolResult = await config.executeTool(toolName, fc.args);
                const truncated = toolResult.length > 8000
                    ? toolResult.slice(0, 8000) + "\n...(truncated)"
                    : toolResult;

                previousCalls.set(callKey, truncated);

                functionResponses.push({
                    functionResponse: { name: fc.name, response: { result: truncated } },
                });
            } catch (err) {
                functionResponses.push({
                    functionResponse: { name: fc.name, response: { error: (err as Error).message } },
                });
            }
        }

        contents.push({ role: "user", parts: functionResponses });
    }

    return {
        answer: "Tool call limit reached.",
        toolsUsed,
        durationMs: Date.now() - startTime,
        inputTokens,
        outputTokens,
    };
}
