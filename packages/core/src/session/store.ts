// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Session Store
 *
 * Manages conversation history for multi-turn agent sessions.
 * Implements structured handoffs (Anthropic harness principle P5):
 * history includes tool usage metadata so subsequent turns know
 * what was already queried and can avoid redundant calls.
 */

import { logger } from "../logger.js";
import { ensurePlatform } from "../platform/bootstrap.js";
import type { SessionMessage } from "../platform/types.js";

export type { SessionMessage };

const MAX_HISTORY_CHARS = 50_000;
const SUMMARY_THRESHOLD_CHARS = 40_000;

export async function saveMessage(
    sessionId: string,
    ts: string,
    role: "user" | "assistant",
    content: string,
    userId: string,
): Promise<void> {
    const registry = ensurePlatform();
    await registry.sessions.saveMessage(sessionId, ts, role, content, userId);
}

export async function getHistory(sessionId: string): Promise<SessionMessage[]> {
    const registry = ensurePlatform();
    return registry.sessions.getHistory(sessionId);
}

/**
 * Build a prompt that includes conversation history with tool usage metadata.
 *
 * Enhanced format (P5 - Structured Handoffs):
 *   User: what's the current sprint?
 *   Assistant: [tools: jira_get_agile_boards, jira_get_sprint_issues] Sprint 6 is active.
 *
 * This gives the LLM context about what tools were already called,
 * preventing redundant calls and enabling informed follow-up queries.
 */
export function buildPromptWithHistory(
    history: SessionMessage[],
    currentQuery: string,
    toolsPerMessage?: Map<string, string[]>,
): string {
    if (history.length === 0) return currentQuery;

    const lines: string[] = [];
    let totalChars = 0;

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const prefix = msg.role === "user" ? "User" : "Assistant";

        // Include tool usage metadata for assistant messages
        let toolPrefix = "";
        if (msg.role === "assistant" && toolsPerMessage) {
            const tools = toolsPerMessage.get(`${i}`);
            if (tools && tools.length > 0) {
                toolPrefix = `[tools: ${tools.join(", ")}] `;
            }
        }

        const line = `${prefix}: ${toolPrefix}${msg.content}`;

        if (totalChars + line.length > MAX_HISTORY_CHARS) break;

        lines.unshift(line);
        totalChars += line.length;
    }

    return `[Conversation history — use as context]\n${lines.join("\n")}\n\n[Current query]\nUser: ${currentQuery}`;
}

/**
 * Summarize conversation history when it exceeds the threshold.
 *
 * Implements Context Management (Anthropic harness principle P4):
 * Instead of raw truncation (compaction), use an LLM call to create
 * a structured summary that preserves key decisions, tool results,
 * and unresolved topics.
 *
 * The summary replaces all previous messages, giving the next query
 * a clean context window with structured handoff.
 */
export async function summarizeHistory(
    sessionId: string,
    history: SessionMessage[],
    callLlm: (options: {
        systemPrompt: string;
        contents: Array<{ role: string; parts: unknown[] }>;
        tools: never[];
    }) => Promise<{ text?: string; inputTokens?: number; outputTokens?: number }>,
): Promise<{ summary: string; inputTokens: number; outputTokens: number } | null> {
    // Only summarize if history is large enough
    const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars < SUMMARY_THRESHOLD_CHARS) return null;

    const historyText = history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");

    const result = await callLlm({
        systemPrompt: [
            "You are a conversation summarizer.",
            "Create a structured summary of the conversation below.",
            "Include: (1) questions asked, (2) tools called and key results,",
            "(3) decisions made, (4) unresolved topics.",
            "Be concise. The summary will replace the full history.",
        ].join(" "),
        contents: [{
            role: "user",
            parts: [{ text: `Summarize this conversation:\n\n${historyText.slice(0, MAX_HISTORY_CHARS)}` }],
        }],
        tools: [],
    });

    const summary = result.text?.trim();
    if (!summary) return null;

    // Save summary as the new session start
    try {
        const registry = ensurePlatform();
        // Clear old messages and save summary (implementation depends on provider)
        await registry.sessions.saveMessage(
            sessionId,
            `summary-${Date.now()}`,
            "assistant",
            `[Session Summary]\n${summary}`,
            "system",
        );
    } catch (err) {
        logger.warn({ err, sessionId }, "Failed to save session summary");
    }

    logger.info(
        { sessionId, originalChars: totalChars, summaryChars: summary.length },
        "Session history summarized",
    );

    return {
        summary,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
    };
}
