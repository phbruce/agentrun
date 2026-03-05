// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Converts raw markdown into Slack Block Kit rich_text blocks.
 *
 * Pipeline: markdown -> markdownToRichTextBlocks() -> Block Kit blocks
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert raw markdown to an array of Block Kit blocks (rich_text + divider).
 *
 * Sections separated by `---` become distinct rich_text blocks with divider
 * blocks between them.
 */
export function markdownToRichTextBlocks(markdown: string): any[] {
    if (!markdown?.trim()) return [];

    const sections = splitBySeparator(markdown);
    const blocks: any[] = [];

    for (const section of sections) {
        if (section === "---") {
            blocks.push({ type: "divider" });
            continue;
        }

        const trimmed = section.trim();
        if (!trimmed) continue;

        const rawElements = parseBlockElements(trimmed);
        const elements = addIntelligentSpacing(rawElements);
        if (elements.length > 0) {
            blocks.push({ type: "rich_text", elements });
        }
    }

    // Strip leading/trailing dividers
    while (blocks.length > 0 && blocks[0].type === "divider") blocks.shift();
    while (blocks.length > 0 && blocks[blocks.length - 1].type === "divider") blocks.pop();

    return blocks;
}

// ---------------------------------------------------------------------------
// Section splitting (respects code fences)
// ---------------------------------------------------------------------------

function splitBySeparator(markdown: string): string[] {
    const lines = markdown.split("\n");
    const sections: string[] = [];
    let current: string[] = [];
    let inCodeFence = false;

    for (const line of lines) {
        if (line.trimStart().startsWith("```")) {
            inCodeFence = !inCodeFence;
            current.push(line);
            continue;
        }

        if (!inCodeFence && /^\s*---\s*$/.test(line)) {
            sections.push(current.join("\n"));
            sections.push("---");
            current = [];
        } else {
            current.push(line);
        }
    }

    sections.push(current.join("\n"));
    return sections;
}

// ---------------------------------------------------------------------------
// Block-level parsing
// ---------------------------------------------------------------------------

function parseBlockElements(text: string): any[] {
    const lines = text.split("\n");
    const elements: any[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Skip blank lines
        if (line.trim() === "") {
            i++;
            continue;
        }

        // Code fence: ```...```
        if (line.trimStart().startsWith("```")) {
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip closing ```
            const code = codeLines.join("\n");
            if (code) {
                elements.push({
                    type: "rich_text_preformatted",
                    elements: [{ type: "text", text: code }],
                });
            }
            continue;
        }

        // Blockquote: > text
        if (line.trimStart().startsWith("> ") || line.trimStart() === ">") {
            const quoteLines: string[] = [];
            while (i < lines.length && (lines[i].trimStart().startsWith("> ") || lines[i].trimStart() === ">")) {
                quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
                i++;
            }
            elements.push({
                type: "rich_text_quote",
                elements: parseInlineElements(quoteLines.join("\n")),
            });
            continue;
        }

        // Header: # text
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const inlineEls = parseInlineElements(headerMatch[2]);
            elements.push({
                type: "rich_text_section",
                _isHeader: true,
                elements: inlineEls.map((el: any) =>
                    el.type === "text" ? { ...el, style: { ...el.style, bold: true } } : el,
                ),
            });
            i++;
            continue;
        }

        // Table: | ... | with separator line
        if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const headers = parseCells(line);
            i += 2;
            const listEls: any[] = [];
            while (i < lines.length && isTableRow(lines[i])) {
                const cells = parseCells(lines[i]);
                const parts = headers
                    .map((h, idx) => {
                        const val = cells[idx]?.trim();
                        return val ? `${h.trim()}: ${val}` : null;
                    })
                    .filter(Boolean);
                listEls.push({
                    type: "rich_text_section",
                    elements: parseInlineElements(parts.join(" | ")),
                });
                i++;
            }
            if (listEls.length > 0) {
                elements.push({ type: "rich_text_list", style: "bullet", elements: listEls });
            }
            continue;
        }

        // Bullet list: - item, * item, + item
        if (/^\s*[-*+]\s+/.test(line)) {
            const items: any[] = [];
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
                const m = lines[i].match(/^\s*[-*+]\s+(.+)$/);
                if (m) {
                    items.push({ type: "rich_text_section", elements: parseInlineElements(m[1]) });
                }
                i++;
            }
            if (items.length > 0) {
                elements.push({ type: "rich_text_list", style: "bullet", elements: items });
            }
            continue;
        }

        // Ordered list: 1. item, 1) item
        if (/^\s*\d+[.)]\s+/.test(line)) {
            const items: any[] = [];
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
                const m = lines[i].match(/^\s*\d+[.)]\s+(.+)$/);
                if (m) {
                    items.push({ type: "rich_text_section", elements: parseInlineElements(m[1]) });
                }
                i++;
            }
            if (items.length > 0) {
                elements.push({ type: "rich_text_list", style: "ordered", elements: items });
            }
            continue;
        }

        // Paragraph: consecutive non-special, non-blank lines
        const paraLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i], lines[i + 1])) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length > 0) {
            elements.push({
                type: "rich_text_section",
                elements: parseInlineElements(paraLines.join("\n")),
            });
        }
    }

    return elements;
}

/** Check if a line starts a new block-level element. */
function isBlockStart(line: string, nextLine?: string): boolean {
    if (line.trimStart().startsWith("```")) return true;
    if (line.trimStart().startsWith("> ") || line.trimStart() === ">") return true;
    if (/^#{1,6}\s+/.test(line)) return true;
    if (/^\s*[-*+]\s+/.test(line)) return true;
    if (/^\s*\d+[.)]\s+/.test(line)) return true;
    if (isTableRow(line) && nextLine !== undefined && isTableSeparator(nextLine)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

/**
 * Parse inline markdown into Slack rich_text inline elements.
 *
 * Priority order (earlier alternatives win at each position):
 *  1. Code spans: `text`
 *  2. Links: [text](url)
 *  3. Bold+Italic: ***text***
 *  4. Bold: **text** / __text__
 *  5. Strikethrough: ~~text~~
 *  6. Italic: *text* (single asterisk, not adjacent to another *)
 *  7. Italic: _text_ (with word-boundary guards to avoid snake_case)
 *  8. Emoji: :name:
 *  9. Plain text: everything else
 */
const INLINE_PATTERN = [
    "`([^`]+)`",                                                     // 1: code
    "\\[([^\\]]+)\\]\\(([^)]+)\\)",                                  // 2,3: link text, url
    "\\*\\*\\*(.+?)\\*\\*\\*",                                       // 4: bold+italic
    "\\*\\*(.+?)\\*\\*",                                             // 5: bold **
    "__(.+?)__",                                                     // 6: bold __
    "~~(.+?)~~",                                                     // 7: strikethrough
    "(?<!\\*)\\*(?!\\*| )(.+?)(?<! )\\*(?!\\*)",                     // 8: italic *
    "(?<![a-zA-Z0-9])_(?!_| )(.+?)(?<! )_(?![a-zA-Z0-9_])",        // 9: italic _
    ":([a-z0-9_+-]+):",                                              // 10: emoji
].join("|");

function parseInlineElements(text: string): any[] {
    const elements: any[] = [];
    const re = new RegExp(INLINE_PATTERN, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
        // Plain text before this match
        if (match.index > lastIndex) {
            elements.push({ type: "text", text: text.slice(lastIndex, match.index) });
        }

        if (match[1] !== undefined) {
            elements.push({ type: "text", text: match[1], style: { code: true } });
        } else if (match[2] !== undefined) {
            elements.push({ type: "link", url: match[3], text: match[2] });
        } else if (match[4] !== undefined) {
            elements.push({ type: "text", text: match[4], style: { bold: true, italic: true } });
        } else if (match[5] !== undefined) {
            elements.push({ type: "text", text: match[5], style: { bold: true } });
        } else if (match[6] !== undefined) {
            elements.push({ type: "text", text: match[6], style: { bold: true } });
        } else if (match[7] !== undefined) {
            elements.push({ type: "text", text: match[7], style: { strike: true } });
        } else if (match[8] !== undefined) {
            elements.push({ type: "text", text: match[8], style: { italic: true } });
        } else if (match[9] !== undefined) {
            elements.push({ type: "text", text: match[9], style: { italic: true } });
        } else if (match[10] !== undefined) {
            elements.push({ type: "emoji", name: match[10] });
        }

        lastIndex = re.lastIndex;
    }

    // Remaining text after last match
    if (lastIndex < text.length) {
        elements.push({ type: "text", text: text.slice(lastIndex) });
    }

    // Ensure at least one element (Slack requires non-empty elements array)
    if (elements.length === 0) {
        elements.push({ type: "text", text });
    }

    return elements;
}

// ---------------------------------------------------------------------------
// Intelligent spacing
// ---------------------------------------------------------------------------

/**
 * Insert blank-line spacers between rich_text elements when the element type
 * changes, except after headers (which flow directly into their content).
 */
function addIntelligentSpacing(elements: any[]): any[] {
    if (elements.length <= 1) return elements.map(stripMeta);

    const result: any[] = [stripMeta(elements[0])];

    for (let i = 1; i < elements.length; i++) {
        const prev = elements[i - 1];
        const curr = elements[i];

        // Header flows into its content — no spacer
        if (prev._isHeader) {
            result.push(stripMeta(curr));
            continue;
        }

        // Different element types -> add spacer
        if (prev.type !== curr.type) {
            result.push({
                type: "rich_text_section",
                elements: [{ type: "text", text: "\n" }],
            });
        }

        result.push(stripMeta(curr));
    }

    return result;
}

/** Remove internal markers (_isHeader) before sending to Slack. */
function stripMeta(el: any): any {
    if (!el._isHeader) return el;
    const { _isHeader, ...clean } = el;
    return clean;
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

function isTableRow(line: string): boolean {
    return !!line && line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isTableSeparator(line: string): boolean {
    return !!line && /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseCells(line: string): string[] {
    return line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
}
