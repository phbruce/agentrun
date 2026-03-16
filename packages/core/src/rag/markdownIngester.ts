// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "crypto";
import type { DocumentIngester, DocumentChunk } from "../platform/types.js";

/**
 * Chunks markdown documents by heading (##, ###, etc.).
 * Each chunk preserves its heading hierarchy as metadata.
 */
export class MarkdownIngester implements DocumentIngester {
    private maxTokens: number;
    private overlap: number;

    constructor(maxTokens = 512, overlap = 50) {
        this.maxTokens = maxTokens;
        this.overlap = overlap;
    }

    chunk(source: string, content: string): DocumentChunk[] {
        const lines = content.split("\n");
        const sections: { heading: string; level: number; content: string; lineStart: number }[] = [];

        let currentHeading = "";
        let currentLevel = 0;
        let currentContent: string[] = [];
        let currentLineStart = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

            if (headingMatch) {
                // Save previous section
                if (currentContent.length > 0) {
                    const text = currentContent.join("\n").trim();
                    if (text.length > 0) {
                        sections.push({
                            heading: currentHeading,
                            level: currentLevel,
                            content: text,
                            lineStart: currentLineStart,
                        });
                    }
                }

                currentLevel = headingMatch[1].length;
                currentHeading = headingMatch[2].trim();
                currentContent = [line];
                currentLineStart = i + 1;
            } else {
                currentContent.push(line);
            }
        }

        // Don't forget the last section
        if (currentContent.length > 0) {
            const text = currentContent.join("\n").trim();
            if (text.length > 0) {
                sections.push({
                    heading: currentHeading,
                    level: currentLevel,
                    content: text,
                    lineStart: currentLineStart,
                });
            }
        }

        // Convert sections to chunks, splitting large sections
        const chunks: DocumentChunk[] = [];

        for (const section of sections) {
            const estimatedTokens = Math.ceil(section.content.length / 4);

            if (estimatedTokens <= this.maxTokens) {
                chunks.push({
                    id: this.generateId(source, section.heading, section.lineStart),
                    content: section.content,
                    metadata: {
                        source,
                        heading: section.heading,
                        level: String(section.level),
                        lineStart: String(section.lineStart),
                    },
                });
            } else {
                // Split large sections by paragraph
                const paragraphs = section.content.split(/\n\n+/);
                let buffer = "";
                let chunkIdx = 0;

                for (const para of paragraphs) {
                    const combined = buffer ? `${buffer}\n\n${para}` : para;
                    const combinedTokens = Math.ceil(combined.length / 4);

                    if (combinedTokens > this.maxTokens && buffer) {
                        chunks.push({
                            id: this.generateId(source, section.heading, section.lineStart, chunkIdx),
                            content: buffer.trim(),
                            metadata: {
                                source,
                                heading: section.heading,
                                level: String(section.level),
                                lineStart: String(section.lineStart),
                                chunkIndex: String(chunkIdx),
                            },
                        });
                        chunkIdx++;

                        // Apply overlap: keep last N chars of previous buffer
                        const overlapChars = this.overlap * 4;
                        buffer = buffer.slice(-overlapChars) + "\n\n" + para;
                    } else {
                        buffer = combined;
                    }
                }

                if (buffer.trim()) {
                    chunks.push({
                        id: this.generateId(source, section.heading, section.lineStart, chunkIdx),
                        content: buffer.trim(),
                        metadata: {
                            source,
                            heading: section.heading,
                            level: String(section.level),
                            lineStart: String(section.lineStart),
                            chunkIndex: String(chunkIdx),
                        },
                    });
                }
            }
        }

        return chunks;
    }

    private generateId(source: string, heading: string, lineStart: number, chunkIdx?: number): string {
        const key = `${source}::${heading}::${lineStart}${chunkIdx !== undefined ? `::${chunkIdx}` : ""}`;
        return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
    }
}
