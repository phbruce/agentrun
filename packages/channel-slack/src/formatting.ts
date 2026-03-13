// SPDX-License-Identifier: AGPL-3.0-only

import type { ResponseCategory } from "@agentrun-ai/core";
import {
    getRoleForUser,
    getDisplayName,
    getRoleConfig,
    getUseCasesForRole,
    getWorkflowsForUseCase,
    getSkillsForRole,
    getMonthlyUsage,
} from "@agentrun-ai/core";
import { markdownToRichTextBlocks } from "./richTextSerializer.js";
import { getUserProfileImage } from "./slackClient.js";
import { renderGreeting as renderGreetingTemplate, renderError as renderErrorTemplate } from "./templateRenderer.js";

interface ToolUsageEntry {
    tool: string;
    timestamp: string;
}

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
// Public API
// ---------------------------------------------------------------------------

export async function formatGreeting(userId: string): Promise<any[]> {
    const role = getRoleForUser(userId, "slack");
    const useCases = getUseCasesForRole(role);

    // Header context blocks
    const headerBlocks: any[] = [];

    // 1. Profile: image + display name
    const displayName = getDisplayName(userId, "slack");
    const profileElements: any[] = [];

    if (userId) {
        const imageUrl = await getUserProfileImage(userId).catch(() => undefined);
        if (imageUrl) {
            profileElements.push({ type: "image", image_url: imageUrl, alt_text: displayName });
        }
    }
    profileElements.push({ type: "plain_text", emoji: true, text: displayName });
    headerBlocks.push({ type: "context", elements: profileElements });

    // 2. Role
    headerBlocks.push({
        type: "context",
        elements: [{ type: "plain_text", emoji: true, text: `Role: ${role}` }],
    });

    // 3. Monthly usage (only if > 0)
    if (userId) {
        try {
            const usage = await getMonthlyUsage(userId);
            if (usage.queryCount > 0) {
                const total = usage.inputTokens + usage.outputTokens;
                headerBlocks.push({
                    type: "context",
                    elements: [{
                        type: "plain_text",
                        emoji: true,
                        text: `Usage this month: ${formatTokenCount(total)} tokens (${usage.queryCount} ${usage.queryCount !== 1 ? "queries" : "query"})`,
                    }],
                });
            }
        } catch {
            // Usage store unavailable -- skip usage display
        }
    }

    // Skill shortcut blocks
    const skills = getSkillsForRole(role);
    const skillBlocks: any[] = [];
    if (skills.length > 0) {
        skillBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: "*Shortcuts*" },
        });
        const buttons = skills.map((s) => ({
            type: "button",
            text: { type: "plain_text", emoji: true, text: s.command },
            action_id: `skill_${s.command}`,
            value: s.command,
        }));
        skillBlocks.push({
            type: "actions",
            elements: buttons,
        });
    }

    // Use case blocks
    const useCaseBlocks: any[] = [];
    for (const uc of useCases) {
        const workflows = getWorkflowsForUseCase(uc.name);
        const options = workflows.map((wf) => ({
            text: { type: "plain_text" as const, emoji: true, text: wf.description },
            value: `wf:${wf.name}`,
        }));

        useCaseBlocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*${uc.name}*\n${uc.description}`,
            },
            ...(options.length > 0 && {
                accessory: {
                    type: "static_select",
                    placeholder: { type: "plain_text", emoji: true, text: "Run" },
                    action_id: `uc_select_${uc.name}`,
                    options,
                },
            }),
        });
    }

    if (useCaseBlocks.length === 0) {
        useCaseBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: "No queries available for this role." },
        });
    }

    return renderGreetingTemplate({
        vars: {},
        slots: {
            header: headerBlocks,
            skills: skillBlocks,
            useCases: useCaseBlocks,
        },
    });
}

export async function formatCategoryResponse(
    category: Exclude<ResponseCategory, "greeting">,
    query: string,
    answer: string,
    toolsUsed: ToolUsageEntry[],
    durationMs: number,
    userId: string,
    tokenUsage?: { input: number; output: number },
): Promise<any[]> {
    const label = CATEGORY_LABELS[category];
    const contentBlocks = markdownToRichTextBlocks(answer);

    // Header: profile image + display name
    const displayName = getDisplayName(userId || "", "slack");
    const profileElements: any[] = [];

    if (userId) {
        const imageUrl = await getUserProfileImage(userId).catch(() => undefined);
        if (imageUrl) {
            profileElements.push({ type: "image", image_url: imageUrl, alt_text: displayName });
        }
    }
    profileElements.push({ type: "plain_text", emoji: true, text: displayName });

    // Footer metadata as context block
    const dedupedTools = Array.from(new Set(toolsUsed.map((t) => t.tool.replace(/^mcp__[^_]+__/, ""))));
    const toolList = dedupedTools.length > 0 ? dedupedTools.join(", ") : "none";
    const total = (tokenUsage?.input ?? 0) + (tokenUsage?.output ?? 0);
    const tokens = total > 0 ? formatTokenCount(total) : "--";
    const footerText = `${label} | ${toolList} | ${(durationMs / 1000).toFixed(1)}s | ${tokens} tokens`;

    return [
        { type: "context", elements: profileElements },
        { type: "divider" },
        ...contentBlocks,
        { type: "divider" },
        {
            type: "context",
            elements: [{ type: "mrkdwn", text: footerText }],
        },
    ];
}

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function formatErrorBlocks(query: string, error: string): any[] {
    return renderErrorTemplate({
        vars: {
            query: truncate(query, 200),
            error,
        },
    });
}

// ---------------------------------------------------------------------------
// Rich text list conversion (legacy)
// ---------------------------------------------------------------------------

/**
 * Parse agent text output into Block Kit blocks.
 *
 * First splits on `---` (horizontal rule) to create visual sections separated
 * by dividers. Within each section, detects:
 * - Key: Value pairs (2+ consecutive -> section fields grid)
 * - `- item` lines -> rich_text_list (native Slack bullets)
 * - Everything else -> section mrkdwn blocks (respecting 3000 char limit)
 *
 * Code blocks (``` ... ```) are never parsed for lists/fields.
 */
export function parseIntoBlocks(text: string): any[] {
    // Split on --- (horizontal rule separator)
    const sections = text.split(/\n---\n|\n---$|^---\n/);
    const blocks: any[] = [];

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        // Divider between visual sections
        if (blocks.length > 0) {
            blocks.push({ type: "divider" });
        }

        // Parse each section's content into segments
        const segments = segmentText(trimmed);
        for (const seg of segments) {
            if (seg.kind === "prose") {
                blocks.push(...splitIntoSections(seg.text));
            } else if (seg.kind === "list") {
                blocks.push(buildRichTextList(seg.items, seg.style));
            } else if (seg.kind === "fields") {
                blocks.push(...buildFieldSections(seg.pairs));
            }
        }
    }

    return blocks;
}

// ---------------------------------------------------------------------------
// Internal: text segmentation
// ---------------------------------------------------------------------------

interface FieldPair {
    key: string;
    value: string;
}

type Segment =
    | { kind: "prose"; text: string }
    | { kind: "list"; style: "bullet" | "ordered"; items: ListItem[] }
    | { kind: "fields"; pairs: FieldPair[] };

interface ListItem {
    parts: RichTextElement[];
}

interface RichTextElement {
    type: "text";
    text: string;
    style?: { bold?: true; italic?: true; code?: true };
}

const BULLET_RE = /^\s*[-] (.+)$/;
const ORDERED_RE = /^\d+[.)]\s+(.+)$/;
const FIELD_RE = /^(\*?[A-Z\u00C0-\u00D6\u00D8-\u00DD][^:*\n]{1,48}\*?):\s+(.+)$/;

function segmentText(text: string): Segment[] {
    const lines = text.split("\n");
    const segments: Segment[] = [];
    let proseBuffer: string[] = [];
    let listItems: ListItem[] = [];
    let listStyle: "bullet" | "ordered" = "bullet";
    let fieldBuffer: FieldPair[] = [];
    let inCodeBlock = false;

    function flushProse(): void {
        if (proseBuffer.length > 0) {
            const joined = proseBuffer.join("\n").trim();
            if (joined) {
                segments.push({ kind: "prose", text: joined });
            }
            proseBuffer = [];
        }
    }

    function flushList(): void {
        if (listItems.length > 0) {
            segments.push({ kind: "list", style: listStyle, items: listItems });
            listItems = [];
        }
    }

    function flushFields(): void {
        if (fieldBuffer.length >= 2) {
            segments.push({ kind: "fields", pairs: fieldBuffer });
        } else if (fieldBuffer.length === 1) {
            proseBuffer.push(`*${fieldBuffer[0].key}:* ${fieldBuffer[0].value}`);
        }
        fieldBuffer = [];
    }

    for (const line of lines) {
        if (line.trimStart().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            flushList();
            flushFields();
            proseBuffer.push(line);
            continue;
        }

        if (inCodeBlock) {
            proseBuffer.push(line);
            continue;
        }

        const bulletMatch = line.match(BULLET_RE);
        const orderedMatch = !bulletMatch ? line.match(ORDERED_RE) : null;
        const fieldMatch = !bulletMatch && !orderedMatch ? line.match(FIELD_RE) : null;

        if (bulletMatch) {
            flushProse();
            flushFields();
            if (listItems.length > 0 && listStyle !== "bullet") {
                flushList();
            }
            listStyle = "bullet";
            listItems.push({ parts: parseInlineFormatting(bulletMatch[1]) });
        } else if (orderedMatch) {
            flushProse();
            flushFields();
            if (listItems.length > 0 && listStyle !== "ordered") {
                flushList();
            }
            listStyle = "ordered";
            listItems.push({ parts: parseInlineFormatting(orderedMatch[1]) });
        } else if (fieldMatch) {
            flushList();
            flushProse();
            const key = fieldMatch[1].replace(/^\*|\*$/g, "").trim();
            fieldBuffer.push({ key, value: fieldMatch[2] });
        } else {
            flushList();
            flushFields();
            proseBuffer.push(line);
        }
    }

    flushList();
    flushFields();
    flushProse();

    return segments;
}

function parseInlineFormatting(text: string): RichTextElement[] {
    const elements: RichTextElement[] = [];
    const re = /(\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
            elements.push({ type: "text", text: text.slice(lastIndex, match.index) });
        }

        const raw = match[0];
        const inner = raw.slice(1, -1);
        if (raw.startsWith("*")) {
            elements.push({ type: "text", text: inner, style: { bold: true } });
        } else if (raw.startsWith("_")) {
            elements.push({ type: "text", text: inner, style: { italic: true } });
        } else if (raw.startsWith("`")) {
            elements.push({ type: "text", text: inner, style: { code: true } });
        }

        lastIndex = re.lastIndex;
    }

    if (lastIndex < text.length) {
        elements.push({ type: "text", text: text.slice(lastIndex) });
    }

    if (elements.length === 0) {
        elements.push({ type: "text", text });
    }

    return elements;
}

// ---------------------------------------------------------------------------
// Internal: Block Kit builders
// ---------------------------------------------------------------------------

function buildFieldSections(pairs: FieldPair[]): any[] {
    const sections: any[] = [];
    for (let i = 0; i < pairs.length; i += 10) {
        const chunk = pairs.slice(i, i + 10);
        sections.push({
            type: "section",
            fields: chunk.map(({ key, value }) => ({
                type: "mrkdwn",
                text: `*${key}*\n${value}`,
            })),
        });
    }
    return sections;
}

function buildRichTextList(items: ListItem[], style: "bullet" | "ordered"): any {
    return {
        type: "rich_text",
        elements: [
            {
                type: "rich_text_list",
                style,
                elements: items.map((item) => ({
                    type: "rich_text_section",
                    elements: item.parts.map((p) => {
                        const el: any = { type: "text", text: p.text };
                        if (p.style) el.style = p.style;
                        return el;
                    }),
                })),
            },
        ],
    };
}

function splitIntoSections(text: string, maxLen = 2900): any[] {
    if (text.length <= maxLen) {
        return [{ type: "section", text: { type: "mrkdwn", text } }];
    }

    const sections: any[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            sections.push({ type: "section", text: { type: "mrkdwn", text: remaining } });
            break;
        }

        let breakAt = remaining.lastIndexOf("\n", maxLen);
        if (breakAt <= 0) breakAt = remaining.lastIndexOf(" ", maxLen);
        if (breakAt <= 0) breakAt = maxLen;

        sections.push({ type: "section", text: { type: "mrkdwn", text: remaining.slice(0, breakAt) } });
        remaining = remaining.slice(breakAt).trimStart();
    }

    return sections;
}

// ---------------------------------------------------------------------------
// Internal: helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max - 3) + "...";
}
