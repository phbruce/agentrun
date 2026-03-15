// SPDX-License-Identifier: AGPL-3.0-only

import { Firestore } from "@google-cloud/firestore";
import type { SessionStore, SessionMessage } from "@agentrun-ai/core";

/**
 * Firestore-backed SessionStore.
 *
 * Documents are stored in the structure:
 *   {collectionName}/{sessionId}/messages/{ts}
 *
 * TTL is handled via a Firestore TTL policy on the `expireAt` field.
 *
 * @param collectionName - Root collection name (default: "agentrun-sessions")
 * @param ttlDays        - TTL in days for session messages (default: 7)
 */
export class FirestoreSessionStore implements SessionStore {
    private firestore: Firestore;
    private collection: string;
    private ttlDays: number;

    constructor(collectionName = "agentrun-sessions", ttlDays = 7) {
        this.firestore = new Firestore();
        this.collection = collectionName;
        this.ttlDays = ttlDays;
    }

    async saveMessage(
        sessionId: string,
        ts: string,
        role: "user" | "assistant",
        content: string,
        userId: string,
    ): Promise<void> {
        const expireAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);

        await this.firestore
            .collection(this.collection)
            .doc(sessionId)
            .collection("messages")
            .doc(ts)
            .set({ role, content, userId, expireAt });
    }

    async getHistory(sessionId: string): Promise<SessionMessage[]> {
        const snapshot = await this.firestore
            .collection(this.collection)
            .doc(sessionId)
            .collection("messages")
            .orderBy("__name__")
            .get();

        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                role: data.role as "user" | "assistant",
                content: data.content as string,
            };
        });
    }
}
