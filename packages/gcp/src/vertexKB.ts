// SPDX-License-Identifier: AGPL-3.0-only

import type { KnowledgeBaseProvider, KnowledgeBaseSearchResult } from "@agentrun-ai/core";

/**
 * Vertex AI Agent Builder (Discovery Engine) knowledge base provider.
 *
 * Uses the Vertex AI Search API to query a managed datastore
 * (embedding + chunking + vector search handled by Vertex AI).
 *
 * @param projectId   - GCP project ID
 * @param location    - GCP region (e.g. "us-central1" or "global")
 * @param datastoreId - Vertex AI Search datastore ID
 */
export class VertexAiKBProvider implements KnowledgeBaseProvider {
    private auth: any = null;

    constructor(
        private readonly projectId: string,
        private readonly location: string,
        private readonly datastoreId: string,
    ) {}

    private async ensureAuth(): Promise<any> {
        if (this.auth) return this.auth;
        const { GoogleAuth } = await import("google-auth-library");
        this.auth = new GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        return this.auth;
    }

    async retrieve(
        query: string,
        topK: number,
        filter?: Record<string, string>,
    ): Promise<KnowledgeBaseSearchResult[]> {
        const auth = await this.ensureAuth();
        const client = await auth.getClient();

        const parent = `projects/${this.projectId}/locations/${this.location}/collections/default_collection/dataStores/${this.datastoreId}/servingConfigs/default_search`;

        const url = `https://discoveryengine.googleapis.com/v1/${parent}:search`;

        const requestBody: any = {
            query,
            pageSize: topK,
            queryExpansionSpec: { condition: "AUTO" },
            spellCorrectionSpec: { mode: "AUTO" },
        };

        // Add metadata filter if provided
        if (filter && Object.keys(filter).length > 0) {
            const filterExpr = Object.entries(filter)
                .map(([key, value]) => `${key} = "${value}"`)
                .join(" AND ");
            requestBody.filter = filterExpr;
        }

        const response = await client.request({
            url,
            method: "POST",
            data: requestBody,
        });

        const results = (response.data as any).results ?? [];

        return results.map((r: any, idx: number) => {
            const doc = r.document ?? {};
            const derivedData = doc.derivedStructData ?? {};
            const chunks = (derivedData.extractive_answers ?? derivedData.snippets) ?? [];
            const content = chunks.map((c: any) => c.content ?? c.snippet ?? "").join("\n");

            return {
                id: doc.id ?? `result-${idx}`,
                content: content || (doc.name ?? ""),
                score: r.score ?? 0,
                metadata: doc.structData ?? {},
                location: doc.name
                    ? {
                          type: "gcs",
                          s3Location: { uri: doc.name },
                      }
                    : undefined,
            };
        });
    }
}
