// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "../logger.js";
import { ensurePlatform } from "../platform/bootstrap.js";

interface ToolResult {
    toolName: string;
    result: string;
}

interface SummarizeResponse {
    answer: string;
    inputTokens: number;
    outputTokens: number;
}

export async function summarizeToolResults(
    systemPrompt: string,
    skillPrompt: string,
    toolResults: ToolResult[],
    model: string,
): Promise<SummarizeResponse> {
    const registry = ensurePlatform();

    logger.info({ model, toolResultsCount: toolResults.length }, "Bedrock summarize starting (via LlmProvider)");

    return registry.llm.summarize(systemPrompt, skillPrompt, toolResults, model);
}
