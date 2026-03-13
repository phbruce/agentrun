// SPDX-License-Identifier: AGPL-3.0-only

import type { AgentResult } from "@agentrun-ai/core";
import type { GChatCard, GChatSection, GChatWidget } from "./gchatClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

function textWidget(text: string): GChatWidget {
    return { textParagraph: { text } };
}

function decoratedWidget(topLabel: string, text: string): GChatWidget {
    return { decoratedText: { topLabel, text } };
}

// ---------------------------------------------------------------------------
// Markdown → Card sections
// ---------------------------------------------------------------------------

/**
 * Parse a markdown answer into GChat card sections.
 *
 * - Splits on `---` to create separate sections
 * - Code blocks are wrapped in backticks (GChat renders monospace)
 * - `Key: Value` pairs become decoratedText widgets
 * - Regular text becomes textParagraph widgets
 */
function parseMarkdownToSections(markdown: string): GChatSection[] {
    const rawSections = markdown.split(/\n---\n|\n---$|^---\n/);
    const sections: GChatSection[] = [];

    for (const raw of rawSections) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const widgets: GChatWidget[] = [];
        const lines = trimmed.split("\n");
        let textBuffer: string[] = [];
        let inCodeBlock = false;

        const flushText = (): void => {
            if (textBuffer.length > 0) {
                const joined = textBuffer.join("\n").trim();
                if (joined) {
                    widgets.push(textWidget(joined));
                }
                textBuffer = [];
            }
        };

        for (const line of lines) {
            if (line.trimStart().startsWith("```")) {
                if (inCodeBlock) {
                    // End of code block
                    textBuffer.push(line);
                    flushText();
                    inCodeBlock = false;
                } else {
                    // Start of code block
                    flushText();
                    inCodeBlock = true;
                    textBuffer.push(line);
                }
                continue;
            }

            if (inCodeBlock) {
                textBuffer.push(line);
                continue;
            }

            // Detect Key: Value pairs (capitalized key, colon, value)
            const fieldMatch = line.match(/^(\*?[A-Z\u00C0-\u00D6\u00D8-\u00DD][^:*\n]{1,48}\*?):\s+(.+)$/);
            if (fieldMatch) {
                flushText();
                const key = fieldMatch[1].replace(/^\*|\*$/g, "").trim();
                widgets.push(decoratedWidget(key, fieldMatch[2]));
                continue;
            }

            textBuffer.push(line);
        }

        flushText();

        if (widgets.length > 0) {
            sections.push({ widgets });
        }
    }

    return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an AgentResult into a Google Chat card.
 */
export function formatAgentResponse(result: AgentResult): GChatCard {
    const sections = parseMarkdownToSections(result.answer);

    // Footer section with metadata
    const dedupedTools = Array.from(new Set(result.toolsUsed.map((t) => t.tool.replace(/^mcp__[^_]+__/, ""))));
    const toolList = dedupedTools.length > 0 ? dedupedTools.join(", ") : "none";
    const total = result.inputTokens + result.outputTokens;
    const tokens = total > 0 ? formatTokenCount(total) : "--";
    const duration = (result.durationMs / 1000).toFixed(1);

    const footerWidgets: GChatWidget[] = [
        { divider: {} },
        textWidget(`<i>Tools: ${toolList} | ${duration}s | ${tokens} tokens</i>`),
    ];

    // Append footer to last section or create new one
    if (sections.length > 0) {
        sections[sections.length - 1].widgets.push(...footerWidgets);
    } else {
        sections.push({ widgets: footerWidgets });
    }

    return {
        header: { title: "AgentRun" },
        sections,
    };
}

/**
 * Create an error card.
 */
export function formatErrorResponse(error: string): GChatCard {
    return {
        header: { title: "AgentRun", subtitle: "Erro" },
        sections: [
            {
                widgets: [
                    textWidget(`<b>Erro:</b> ${truncate(error, 1000)}`),
                ],
            },
        ],
    };
}

/**
 * Create a greeting card for new users / DMs.
 */
export function formatGreetingCard(displayName: string, role: string): GChatCard {
    return {
        header: {
            title: "AgentRun",
            subtitle: `Bem-vindo, ${displayName}`,
        },
        sections: [
            {
                widgets: [
                    decoratedWidget("User", displayName),
                    decoratedWidget("Role", role),
                ],
            },
            {
                header: "Como usar",
                widgets: [
                    textWidget(
                        "Envie uma mensagem neste chat para consultar a infraestrutura. " +
                        "Exemplos:\n" +
                        "- <i>/health-check</i> -- status geral\n" +
                        "- <i>/lambda-find nome</i> -- detalhes de uma Lambda\n" +
                        "- <i>/dlq-alert</i> -- filas com mensagens pendentes\n" +
                        "- <i>/deploy-status</i> -- PRs e commits recentes",
                    ),
                ],
            },
        ],
    };
}
