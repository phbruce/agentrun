// SPDX-License-Identifier: AGPL-3.0-only

import {
    classifyQuery,
    type ResponseCategory,
} from "@agentrun-oss/core";
import { formatGreeting, formatCategoryResponse, formatErrorBlocks } from "./formatting.js";

interface ToolUsageEntry {
    tool: string;
    timestamp: string;
}

interface TokenUsage {
    input: number;
    output: number;
}

export async function formatAgentResponse(
    query: string,
    answer: string,
    toolsUsed: ToolUsageEntry[],
    durationMs: number,
    tokenUsage?: TokenUsage,
    userId?: string,
): Promise<any[]> {
    const category = classifyQuery(query);

    if (category === "greeting") {
        return formatGreeting(userId ?? "");
    }

    return formatCategoryResponse(category as Exclude<ResponseCategory, "greeting">, query, answer, toolsUsed, durationMs, userId ?? "", tokenUsage);
}

export function formatErrorResponse(query: string, error: string): any[] {
    return formatErrorBlocks(query, error);
}

export { classifyQuery, type ResponseCategory } from "@agentrun-oss/core";
export { formatGreeting } from "./formatting.js";
