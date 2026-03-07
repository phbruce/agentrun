// SPDX-License-Identifier: AGPL-3.0-only

import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data";
import type { VectorStore, VectorChunk } from "@agentrun-ai/core";

/**
 * pgvector-backed VectorStore using Aurora Data API (HTTP endpoint).
 *
 * Default table: `{schema}.knowledge_chunks` where schema defaults to "agentrun".
 *
 * Expected table schema:
 *   CREATE TABLE {schema}.knowledge_chunks (
 *     id          TEXT PRIMARY KEY,
 *     content     TEXT NOT NULL,
 *     metadata    JSONB NOT NULL DEFAULT '{}',
 *     embedding   vector(1024) NOT NULL,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 */
export class PgVectorStore implements VectorStore {
    private client: RDSDataClient;
    private clusterArn: string;
    private secretArn: string;
    private database: string;
    private schema: string;

    constructor(
        region: string,
        clusterArn: string,
        secretArn: string,
        database: string,
        schema = "agentrun",
    ) {
        this.client = new RDSDataClient({ region });
        this.clusterArn = clusterArn;
        this.secretArn = secretArn;
        this.database = database;
        this.schema = schema;
    }

    private get table(): string {
        return `${this.schema}.knowledge_chunks`;
    }

    async search(
        vector: number[],
        topK: number,
        filter?: Record<string, string>,
    ): Promise<VectorChunk[]> {
        const vectorStr = `[${vector.join(",")}]`;

        let whereClause = "";
        const safeTopK = Math.max(1, Math.min(100, Math.floor(topK)));
        const params: any[] = [
            { name: "embedding", value: { stringValue: vectorStr } },
        ];

        if (filter && Object.keys(filter).length > 0) {
            const conditions: string[] = [];
            let idx = 0;
            for (const [key, value] of Object.entries(filter)) {
                const paramName = `filter_${idx}`;
                conditions.push(`metadata->>'${key.replace(/'/g, "''")}' = :${paramName}`);
                params.push({ name: paramName, value: { stringValue: value } });
                idx++;
            }
            whereClause = `WHERE ${conditions.join(" AND ")}`;
        }

        const sql = `
            SELECT id, content, metadata,
                   1 - (embedding <=> :embedding::vector) AS similarity
            FROM ${this.table}
            ${whereClause}
            ORDER BY embedding <=> :embedding::vector
            LIMIT ${safeTopK}
        `;

        const result = await this.client.send(
            new ExecuteStatementCommand({
                resourceArn: this.clusterArn,
                secretArn: this.secretArn,
                database: this.database,
                sql,
                parameters: params,
                includeResultMetadata: true,
            }),
        );

        return (result.records ?? []).map((row: any[]) => ({
            id: row[0]?.stringValue ?? "",
            content: row[1]?.stringValue ?? "",
            metadata: JSON.parse(row[2]?.stringValue ?? "{}"),
            similarity: parseFloat(row[3]?.stringValue ?? row[3]?.doubleValue?.toString() ?? "0"),
        }));
    }

    async upsert(
        chunks: { id: string; content: string; vector: number[]; metadata: Record<string, string> }[],
    ): Promise<number> {
        let count = 0;

        // Process in batches of 10 to avoid Data API limits
        for (let i = 0; i < chunks.length; i += 10) {
            const batch = chunks.slice(i, i + 10);

            for (const chunk of batch) {
                const vectorStr = `[${chunk.vector.join(",")}]`;

                await this.client.send(
                    new ExecuteStatementCommand({
                        resourceArn: this.clusterArn,
                        secretArn: this.secretArn,
                        database: this.database,
                        sql: `
                            INSERT INTO ${this.table} (id, content, metadata, embedding)
                            VALUES (:id, :content, :metadata::jsonb, :embedding::vector)
                            ON CONFLICT (id) DO UPDATE
                            SET content = :content, metadata = :metadata::jsonb,
                                embedding = :embedding::vector
                        `,
                        parameters: [
                            { name: "id", value: { stringValue: chunk.id } },
                            { name: "content", value: { stringValue: chunk.content } },
                            { name: "metadata", value: { stringValue: JSON.stringify(chunk.metadata) } },
                            { name: "embedding", value: { stringValue: vectorStr } },
                        ],
                    }),
                );

                count++;
            }
        }

        return count;
    }

    async delete(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;

        // Data API doesn't support arrays in parameters, so build the IN clause
        const params = ids.map((id, i) => ({
            name: `id_${i}`,
            value: { stringValue: id },
        }));
        const placeholders = ids.map((_, i) => `:id_${i}`).join(", ");

        const result = await this.client.send(
            new ExecuteStatementCommand({
                resourceArn: this.clusterArn,
                secretArn: this.secretArn,
                database: this.database,
                sql: `DELETE FROM ${this.table} WHERE id IN (${placeholders})`,
                parameters: params,
            }),
        );

        return result.numberOfRecordsUpdated ?? 0;
    }
}
