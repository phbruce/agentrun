// SPDX-License-Identifier: AGPL-3.0-only

import type { AgentResult } from "@agentrun-ai/core";
import {
    getRoleForUser,
    getDisplayName,
    getSkillsForRole,
    getUseCasesForRole,
    getMonthlyUsage,
    classifyQuery,
} from "@agentrun-ai/core";
import type { ResponseCategory } from "@agentrun-ai/core";
import type { GChatCard, GChatSection, GChatWidget, GChatButton } from "./gchatClient.js";

// ---------------------------------------------------------------------------
// Category labels (mirrors Slack formatting)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Exclude<ResponseCategory, "greeting">, string> = {
    lambda: "Lambda",
    kubernetes: "Kubernetes",
    database: "Database",
    logs: "Logs",
    pull_requests: "Pull Requests",
    metrics: "Metrics",
    sqs: "SQS",
    generic: "Infrastructure",
};

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

function markdownToHtml(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")       // **bold**
        .replace(/\*(.+?)\*/g, "<b>$1</b>")            // *bold*
        .replace(/__(.+?)__/g, "<i>$1</i>")             // __italic__
        .replace(/`([^`]+)`/g, "<font face=\"monospace\">$1</font>") // `code`
        .replace(/^#+\s+(.+)$/gm, "<b>$1</b>")         // # Headers
        .replace(/^[-*]\s+/gm, "• ")                    // - list items
        .replace(/^\d+\.\s+/gm, (m) => m)               // 1. keep numbered
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>'); // [text](url)
}

function textWidget(text: string): GChatWidget {
    return { textParagraph: { text: markdownToHtml(text) } };
}

function decoratedWidget(topLabel: string, text: string): GChatWidget {
    return { decoratedText: { topLabel, text: markdownToHtml(text) } };
}

// ---------------------------------------------------------------------------
// Markdown → Card sections
// ---------------------------------------------------------------------------

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
                    textBuffer.push(line);
                    flushText();
                    inCodeBlock = false;
                } else {
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

            // Detect Key: Value pairs
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
 * Format an AgentResult as a Google Chat card.
 * Mirrors the Slack formatting: profile header, content, footer with metadata.
 */
export function formatAgentResponse(result: AgentResult, userId?: string, source?: string): GChatCard {
    const sections = parseMarkdownToSections(result.answer);

    // Determine category for label
    const category = classifyQuery(result.answer.slice(0, 100));
    const label = category !== "greeting" ? CATEGORY_LABELS[category] : "Infrastructure";

    // Profile header section
    const displayName = userId && source ? getDisplayName(userId, source) : "Usuário";
    const headerSection: GChatSection = {
        widgets: [
            decoratedWidget("User", displayName),
        ],
    };

    // Footer section with metadata (mirrors Slack footer)
    const dedupedTools = Array.from(new Set(result.toolsUsed.map((t) => t.tool.replace(/^mcp__[^_]+__/, ""))));
    const toolList = dedupedTools.length > 0 ? dedupedTools.join(", ") : "none";
    const total = result.inputTokens + result.outputTokens;
    const tokens = total > 0 ? formatTokenCount(total) : "--";
    const duration = (result.durationMs / 1000).toFixed(1);

    const footerSection: GChatSection = {
        widgets: [
            textWidget(`<i>${label} | ${toolList} | ${duration}s | ${tokens} tokens</i>`),
        ],
    };

    return {
        header: { title: "InfraBot", subtitle: label },
        sections: [headerSection, ...sections, footerSection],
    };
}

/**
 * Create an error card.
 */
export function formatErrorResponse(error: string): GChatCard {
    return {
        header: { title: "InfraBot", subtitle: "Erro" },
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
 * Create a greeting card with profile, usage, skills, and use-cases.
 * Mirrors the Slack greeting: user info, shortcuts, available queries.
 */
export async function formatGreetingCard(displayName: string, role: string, userId?: string, source?: string): Promise<GChatCard> {
    // Profile section
    const profileWidgets: GChatWidget[] = [
        decoratedWidget("User", displayName),
        decoratedWidget("Role", role),
    ];

    // Monthly usage
    if (userId) {
        try {
            const usage = await getMonthlyUsage(userId);
            if (usage.queryCount > 0) {
                const total = usage.inputTokens + usage.outputTokens;
                profileWidgets.push(
                    decoratedWidget("Uso mensal", `${formatTokenCount(total)} tokens (${usage.queryCount} ${usage.queryCount !== 1 ? "consultas" : "consulta"})`),
                );
            }
        } catch {
            // Usage store unavailable
        }
    }

    const sections: GChatSection[] = [{ widgets: profileWidgets }];

    // Skills as buttons (mirrors Slack shortcuts)
    const skills = getSkillsForRole(role);
    if (skills.length > 0) {
        const buttons: GChatButton[] = skills.map((s) => ({
            text: s.command,
            onClick: {
                action: {
                    function: "skill_invoke",
                    parameters: [{ key: "command", value: s.command }],
                },
            },
        }));

        sections.push({
            header: "Atalhos",
            widgets: [{ buttonList: { buttons } }],
        });
    }

    // Use-cases list (mirrors Slack dropdown)
    const useCases = getUseCasesForRole(role);
    if (useCases.length > 0) {
        const ucWidgets: GChatWidget[] = useCases.map((uc) =>
            textWidget(`<b>${uc.name}</b>\n${uc.description}`),
        );
        sections.push({
            header: "Consultas disponíveis",
            widgets: ucWidgets,
        });
    }

    // How to use
    sections.push({
        header: "Como usar",
        widgets: [
            textWidget(
                "Envie uma mensagem para consultar a infraestrutura. Exemplos:\n" +
                "- <i>/health-check</i> — status geral\n" +
                "- <i>/lambda-find nome</i> — detalhes de uma Lambda\n" +
                "- <i>/dlq-alert</i> — filas com mensagens pendentes\n" +
                "- <i>/deploy-status</i> — PRs e commits recentes",
            ),
        ],
    });

    return {
        header: { title: "InfraBot", subtitle: `Bem-vindo, ${displayName}` },
        sections,
    };
}
