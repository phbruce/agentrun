// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { PlatformRegistry } from "@agentrun-ai/core";

export function createSearchKnowledgeBase() {
    return tool(
        "search_knowledge_base",
        "Search the knowledge base for relevant documentation. Returns ranked text chunks from ingested documents (e.g., architecture docs, runbooks). Use this to answer questions about platform architecture, design, or operational procedures.",
        {
            query: z
                .string()
                .describe("Natural language search query"),
            topK: z
                .number()
                .int()
                .min(1)
                .max(20)
                .default(5)
                .describe("Number of results to return (default: 5)"),
            source: z
                .string()
                .optional()
                .describe("Filter by source document"),
        },
        async (args) => {
            const registry = PlatformRegistry.instance();
            const knowledgeBase = registry.knowledgeBase;
            const embeddings = registry.embeddings;
            const vectorStore = registry.vectorStore;

            // Prefer managed KB provider (Vertex AI Search, etc.)
            if (knowledgeBase) {
                try {
                    const filter: Record<string, string> = {};
                    if (args.source) {
                        filter.source = args.source;
                    }

                    const results = await knowledgeBase.retrieve(
                        args.query,
                        args.topK,
                        Object.keys(filter).length > 0 ? filter : undefined,
                    );

                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify(
                                    {
                                        query: args.query,
                                        provider: "knowledgeBase",
                                        resultCount: results.length,
                                        results: results.map((r) => ({
                                            id: r.id,
                                            score: Math.round(r.score * 1000) / 1000,
                                            content: r.content,
                                            metadata: r.metadata,
                                            source: r.location?.s3Location?.uri,
                                        })),
                                    },
                                    null,
                                    2,
                                ),
                            },
                        ],
                    };
                } catch (err: any) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify({
                                    error: err.message,
                                    stack: err.stack?.split("\n").slice(0, 5),
                                }),
                            },
                        ],
                    };
                }
            }

            // Fallback: custom embed + vectorStore path (for OSS users)
            if (!embeddings || !vectorStore) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                error: "RAG providers not configured. Add knowledgeBase (recommended) or embeddings + vectorStore to platform config.",
                            }),
                        },
                    ],
                };
            }

            try {
                const embeddingResult = await embeddings.embed(args.query);

                const filter: Record<string, string> = {};
                if (args.source) {
                    filter.source = args.source;
                }

                const results = await vectorStore.search(
                    embeddingResult.vector,
                    args.topK,
                    Object.keys(filter).length > 0 ? filter : undefined,
                );

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    query: args.query,
                                    provider: "vectorStore",
                                    resultCount: results.length,
                                    embeddingModel: embeddingResult.model,
                                    embeddingTokens: embeddingResult.inputTokens,
                                    results: results.map((r) => ({
                                        id: r.id,
                                        similarity: Math.round(r.similarity * 1000) / 1000,
                                        source: r.metadata.source,
                                        heading: r.metadata.heading,
                                        content: r.content,
                                    })),
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            } catch (err: any) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                error: err.message,
                                stack: err.stack?.split("\n").slice(0, 5),
                            }),
                        },
                    ],
                };
            }
        },
    );
}

export const searchKnowledgeBase = createSearchKnowledgeBase();
