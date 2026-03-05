// SPDX-License-Identifier: AGPL-3.0-only

import type { KnowledgeBaseProvider, KnowledgeBaseSearchResult } from "@agentrun-oss/core";

/**
 * Amazon Bedrock Knowledge Bases provider.
 *
 * Uses RetrieveCommand from @aws-sdk/client-bedrock-agent-runtime
 * to query a managed KB (embedding + chunking + vector search handled by Bedrock).
 */
export class BedrockKBProvider implements KnowledgeBaseProvider {
    private client: any = null;
    private RetrieveCommand: any = null;

    constructor(
        private readonly region: string,
        private readonly knowledgeBaseId: string,
    ) {}

    private async ensureClient(): Promise<void> {
        if (this.client) return;
        const sdk = await import("@aws-sdk/client-bedrock-agent-runtime");
        this.client = new sdk.BedrockAgentRuntimeClient({ region: this.region });
        this.RetrieveCommand = sdk.RetrieveCommand;
    }

    async retrieve(
        query: string,
        topK: number,
        filter?: Record<string, string>,
    ): Promise<KnowledgeBaseSearchResult[]> {
        await this.ensureClient();

        const input: any = {
            knowledgeBaseId: this.knowledgeBaseId,
            retrievalQuery: { text: query },
            retrievalConfiguration: {
                vectorSearchConfiguration: {
                    numberOfResults: topK,
                },
            },
        };

        // Add metadata filter if provided
        if (filter && Object.keys(filter).length > 0) {
            const filterConditions = Object.entries(filter).map(([key, value]) => ({
                equals: { key, value },
            }));

            input.retrievalConfiguration.vectorSearchConfiguration.filter =
                filterConditions.length === 1
                    ? filterConditions[0]
                    : { andAll: filterConditions };
        }

        const response = await this.client.send(new this.RetrieveCommand(input));

        return (response.retrievalResults ?? []).map((r: any, idx: number) => ({
            id: `result-${idx}`,
            content: r.content?.text ?? "",
            score: r.score ?? 0,
            metadata: r.metadata ?? {},
            location: r.location
                ? {
                      type: r.location.type,
                      s3Location: r.location.s3Location
                          ? { uri: r.location.s3Location.uri }
                          : undefined,
                  }
                : undefined,
        }));
    }
}
