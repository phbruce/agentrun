// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Convert standard markdown to Slack mrkdwn format.
 */
export function markdownToMrkdwn(text: string): string {
    let result = text;

    // Bold: **text** or __text__ -> *text*
    result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
    result = result.replace(/__(.+?)__/g, "*$1*");

    // Links: [text](url) -> <url|text>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

    // Headers: # Header -> *Header*
    result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

    // Code blocks: remove language hints (```language -> ```)
    result = result.replace(/```\w+\n/g, "```\n");

    // Tables -> bullet points
    result = convertTables(result);

    return result;
}

function convertTables(text: string): string {
    const lines = text.split("\n");
    const output: string[] = [];
    let i = 0;

    while (i < lines.length) {
        if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const headers = parseCells(lines[i]);
            i += 2;

            while (i < lines.length && isTableRow(lines[i])) {
                const cells = parseCells(lines[i]);
                const parts = headers
                    .map((h, idx) => {
                        const val = cells[idx]?.trim();
                        return val ? `${h.trim()}: ${val}` : null;
                    })
                    .filter(Boolean);
                output.push(`- ${parts.join(" | ")}`);
                i++;
            }
        } else {
            output.push(lines[i]);
            i++;
        }
    }

    return output.join("\n");
}

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
