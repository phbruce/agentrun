// SPDX-License-Identifier: AGPL-3.0-only

import type { VectorStore, VectorChunk } from "@agentrun-ai/core";

/**
 * Cloud SQL PostgreSQL + pgvector-backed VectorStore.
 *
 * Uses standard `pg` client for connection (unlike AWS PgVectorStore which uses RDS Data API).
 *
 * Default table: `{schema}.knowledge_chunks` where schema defaults to "agentrun".
 *
 * Expected table schema:
 *   CREATE TABLE {schema}.knowledge_chunks (
 *     id          TEXT PRIMARY KEY,
 *     content     TEXT NOT NULL,
 *     metadata    JSONB NOT NULL DEFAULT '{}',
 *     embedding   vector(768) NOT NULL,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * @param connectionString - PostgreSQL connection string
 * @param schema           - Database schema name (default: "agentrun")
 */
export class CloudSqlVectorStore implements VectorStore {
    private pool: any = null;
    private readonly connectionString: string;
    private readonly schema: string;

    constructor(connectionString: string, schema = "agentrun") {
        this.connectionString = connectionString;
        this.schema = schema;
    }

    private get table(): string {
        return `${this.schema}.knowledge_chunks`;
    }

    private async ensurePool(): Promise<any> {
        if (this.pool) return this.pool;
        const { Pool } = await import("pg");
        this.pool = new Pool({ connectionString: this.connectionString });
        return this.pool;
    }

    async search(
        vector: number[],
        topK: number,
        filter?: Record<string, string>,
    ): Promise<VectorChunk[]> {
        const pool = await this.ensurePool();
        const vectorStr = `[${vector.join(",")}]`;
        const safeTopK = Math.max(1, Math.min(100, Math.floor(topK)));

        const params: any[] = [vectorStr, safeTopK];
        let whereClause = "";

        if (filter && Object.keys(filter).length > 0) {
            const conditions: string[] = [];
            for (const [key, value] of Object.entries(filter)) {
                params.push(value);
                conditions.push(`metadata->>'${key.replace(/'/g, "''")}' = $${params.length}`);
            }
            whereClause = `WHERE ${conditions.join(" AND ")}`;
        }

        const sql = `
            SELECT id, content, metadata,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM ${this.table}
            ${whereClause}
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        `;

        const result = await pool.query(sql, params);

        return result.rows.map((row: any) => ({
            id: row.id,
            content: row.content,
            metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
            similarity: parseFloat(row.similarity),
        }));
    }

    async upsert(
        chunks: { id: string; content: string; vector: number[]; metadata: Record<string, string> }[],
    ): Promise<number> {
        const pool = await this.ensurePool();
        let count = 0;

        // Process in batches of 10
        for (let i = 0; i < chunks.length; i += 10) {
            const batch = chunks.slice(i, i + 10);

            for (const chunk of batch) {
                const vectorStr = `[${chunk.vector.join(",")}]`;

                await pool.query(
                    `
                    INSERT INTO ${this.table} (id, content, metadata, embedding)
                    VALUES ($1, $2, $3::jsonb, $4::vector)
                    ON CONFLICT (id) DO UPDATE
                    SET content = $2, metadata = $3::jsonb, embedding = $4::vector
                    `,
                    [chunk.id, chunk.content, JSON.stringify(chunk.metadata), vectorStr],
                );

                count++;
            }
        }

        return count;
    }

    async delete(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;

        const pool = await this.ensurePool();

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const result = await pool.query(
            `DELETE FROM ${this.table} WHERE id IN (${placeholders})`,
            ids,
        );

        return result.rowCount ?? 0;
    }
}
