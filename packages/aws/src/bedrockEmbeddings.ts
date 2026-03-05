// SPDX-License-Identifier: AGPL-3.0-only

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingProvider, EmbeddingResult } from "@agentrun-oss/core";

export class BedrockEmbeddingProvider implements EmbeddingProvider {
    private client: BedrockRuntimeClient;
    private modelId: string;
    private _dimensions: number;

    constructor(region: string, modelId = "amazon.titan-embed-text-v2:0", dimensions = 1024) {
        this.client = new BedrockRuntimeClient({ region });
        this.modelId = modelId;
        this._dimensions = dimensions;
    }

    dimensions(): number {
        return this._dimensions;
    }

    async embed(text: string): Promise<EmbeddingResult> {
        const body = JSON.stringify({
            inputText: text,
            dimensions: this._dimensions,
        });

        const response = await this.client.send(
            new InvokeModelCommand({
                modelId: this.modelId,
                contentType: "application/json",
                accept: "application/json",
                body: new TextEncoder().encode(body),
            }),
        );

        const parsed = JSON.parse(new TextDecoder().decode(response.body));

        return {
            vector: parsed.embedding,
            model: this.modelId,
            inputTokens: parsed.inputTextTokenCount ?? 0,
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
        // Titan Embed v2 doesn't support native batch — parallelize
        return Promise.all(texts.map((t) => this.embed(t)));
    }
}
