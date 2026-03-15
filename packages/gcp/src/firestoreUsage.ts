// SPDX-License-Identifier: AGPL-3.0-only

import { Firestore, FieldValue } from "@google-cloud/firestore";
import type { UsageStore, MonthlyUsage } from "@agentrun-ai/core";

/**
 * Firestore-backed UsageStore.
 *
 * Documents are stored as:
 *   {collectionName}/{userId}/{month} (YYYY-MM)
 *
 * Uses FieldValue.increment() for atomic counter updates.
 *
 * @param collectionName - Root collection name (default: "agentrun-usage")
 */
export class FirestoreUsageStore implements UsageStore {
    private firestore: Firestore;
    private collection: string;

    constructor(collectionName = "agentrun-usage") {
        this.firestore = new Firestore();
        this.collection = collectionName;
    }

    private currentMonth(): string {
        return new Date().toISOString().slice(0, 7);
    }

    async track(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
        const docRef = this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("months")
            .doc(this.currentMonth());

        await docRef.set(
            {
                inputTokens: FieldValue.increment(inputTokens),
                outputTokens: FieldValue.increment(outputTokens),
                queryCount: FieldValue.increment(1),
            },
            { merge: true },
        );
    }

    async getMonthly(userId: string): Promise<MonthlyUsage> {
        const doc = await this.firestore
            .collection(this.collection)
            .doc(userId)
            .collection("months")
            .doc(this.currentMonth())
            .get();

        if (!doc.exists) {
            return { inputTokens: 0, outputTokens: 0, queryCount: 0 };
        }

        const data = doc.data()!;
        return {
            inputTokens: data.inputTokens ?? 0,
            outputTokens: data.outputTokens ?? 0,
            queryCount: data.queryCount ?? 0,
        };
    }
}
