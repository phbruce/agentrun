// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";
import type { VectorStore, VectorChunk } from "@agentrun-ai/core";

/**
 * Firestore-backed VectorStore using native vector search.
 *
 * Uses Firestore's built-in vector search (findNearest) for similarity queries.
 * No PostgreSQL required — all data lives in Firestore.
 *
 * Collection structure:
 *   {collection}/{id} → { content, metadata, embedding, createdAt }
 *
 * Requires a vector index on the `embedding` field:
 *   gcloud firestore indexes composite create \
 *     --collection-group={collection} \
 *     --query-scope=COLLECTION \
 *     --field-config=vector-config='{"dimension":768,"flat":{}}',field-path=embedding
 *
 * @param collectionName - Firestore collection name (default: "knowledge-chunks")
 * @param dimensions     - Vector dimensions (default: 768, matches text-embedding-005)
 */
export class FirestoreVectorStore implements VectorStore {
    private db: any = null;
    private readonly collectionName: string;
    private readonly _dimensions: number;

    constructor(collectionName = "knowledge-chunks", dimensions = 768) {
        this.collectionName = collectionName;
        this._dimensions = dimensions;
    }

    private async ensureDb(): Promise<any> {
        if (this.db) return this.db;
        const { Firestore } = await import("@google-cloud/firestore");
        this.db = new Firestore();
        return this.db;
    }

    async search(
        vector: number[],
        topK: number,
        filter?: Record<string, string>,
    ): Promise<VectorChunk[]> {
        const db = await this.ensureDb();
        const safeTopK = Math.max(1, Math.min(100, Math.floor(topK)));

        let query = db.collection(this.collectionName);

        // Apply metadata filters before vector search
        if (filter && Object.keys(filter).length > 0) {
            for (const [key, value] of Object.entries(filter)) {
                query = query.where(`metadata.${key}`, "==", value);
            }
        }

        // Firestore native vector search (findNearest)
        const snapshot = await query
            .findNearest("embedding", vector, {
                limit: safeTopK,
                distanceMeasure: "COSINE",
            })
            .get();

        return snapshot.docs.map((doc: any) => {
            const data = doc.data();
            return {
                id: doc.id,
                content: data.content ?? "",
                metadata: data.metadata ?? {},
                similarity: data._distance != null ? 1 - data._distance : 0,
            };
        });
    }

    async upsert(
        chunks: { id: string; content: string; vector: number[]; metadata: Record<string, string> }[],
    ): Promise<number> {
        const db = await this.ensureDb();
        const collection = db.collection(this.collectionName);
        let count = 0;

        // Firestore batch writes (max 500 per batch)
        const batchSize = 500;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = db.batch();
            const slice = chunks.slice(i, i + batchSize);

            for (const chunk of slice) {
                const ref = collection.doc(chunk.id);
                batch.set(ref, {
                    content: chunk.content,
                    metadata: chunk.metadata,
                    embedding: chunk.vector,
                    createdAt: new Date(),
                }, { merge: true });
                count++;
            }

            await batch.commit();
        }

        logger.info({ count, collection: this.collectionName }, "Firestore vector upsert complete");
        return count;
    }

    async delete(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;

        const db = await this.ensureDb();
        const collection = db.collection(this.collectionName);
        let count = 0;

        // Batch deletes (max 500 per batch)
        const batchSize = 500;
        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = db.batch();
            const slice = ids.slice(i, i + batchSize);

            for (const id of slice) {
                batch.delete(collection.doc(id));
                count++;
            }

            await batch.commit();
        }

        return count;
    }
}
