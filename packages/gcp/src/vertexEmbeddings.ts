// SPDX-License-Identifier: AGPL-3.0-only

import type { EmbeddingProvider, EmbeddingResult } from "@agentrun-ai/core";

/**
 * Vertex AI Text Embedding provider.
 *
 * Uses the Vertex AI prediction API to generate text embeddings.
 *
 * @param projectId  - GCP project ID
 * @param location   - GCP region (default: "us-central1")
 * @param model      - Embedding model name (default: "text-embedding-005")
 * @param dimensions - Embedding vector dimensions (default: 768)
 */
export class VertexAiEmbeddingProvider implements EmbeddingProvider {
    private client: any = null;
    private readonly projectId: string;
    private readonly location: string;
    private readonly modelId: string;
    private readonly _dimensions: number;

    constructor(
        projectId: string,
        location = "us-central1",
        model = "text-embedding-005",
        dimensions = 768,
    ) {
        this.projectId = projectId;
        this.location = location;
        this.modelId = model;
        this._dimensions = dimensions;
    }

    private async ensureClient(): Promise<any> {
        if (this.client) return this.client;
        // Vertex AI embeddings use the prediction REST endpoint directly
        const { GoogleAuth } = await import("google-auth-library");
        this.client = new GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        return this.client;
    }

    dimensions(): number {
        return this._dimensions;
    }

    async embed(text: string): Promise<EmbeddingResult> {
        const auth = await this.ensureClient();
        const client = await auth.getClient();

        const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.modelId}:predict`;

        const requestBody = {
            instances: [{ content: text }],
            parameters: { outputDimensionality: this._dimensions },
        };

        const response = await client.request({
            url,
            method: "POST",
            data: requestBody,
        });

        const prediction = (response.data as any).predictions?.[0];

        return {
            vector: prediction?.embeddings?.values ?? [],
            model: this.modelId,
            inputTokens: prediction?.embeddings?.statistics?.token_count ?? 0,
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
        const auth = await this.ensureClient();
        const client = await auth.getClient();

        const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.modelId}:predict`;

        const requestBody = {
            instances: texts.map((content) => ({ content })),
            parameters: { outputDimensionality: this._dimensions },
        };

        const response = await client.request({
            url,
            method: "POST",
            data: requestBody,
        });

        const predictions = (response.data as any).predictions ?? [];

        return predictions.map((prediction: any) => ({
            vector: prediction?.embeddings?.values ?? [],
            model: this.modelId,
            inputTokens: prediction?.embeddings?.statistics?.token_count ?? 0,
        }));
    }
}
