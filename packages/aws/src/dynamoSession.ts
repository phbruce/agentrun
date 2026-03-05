// SPDX-License-Identifier: AGPL-3.0-only

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { SessionStore, SessionMessage } from "@agentrun-oss/core";

export class DynamoSessionStore implements SessionStore {
    private client: DynamoDBDocumentClient;
    private table: string;
    private ttlSeconds: number;

    constructor(tableName: string, ttlDays: number = 7) {
        this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
        this.table = tableName;
        this.ttlSeconds = ttlDays * 24 * 60 * 60;
    }

    async saveMessage(
        sessionId: string,
        ts: string,
        role: "user" | "assistant",
        content: string,
        userId: string,
    ): Promise<void> {
        const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;

        await this.client.send(
            new PutCommand({
                TableName: this.table,
                Item: { sessionId, ts, role, content, userId, ttl },
            }),
        );
    }

    async getHistory(sessionId: string): Promise<SessionMessage[]> {
        const result = await this.client.send(
            new QueryCommand({
                TableName: this.table,
                KeyConditionExpression: "sessionId = :sid",
                ExpressionAttributeValues: { ":sid": sessionId },
                ScanIndexForward: true,
            }),
        );

        return (result.Items ?? []).map((item) => ({
            role: item.role as "user" | "assistant",
            content: item.content as string,
        }));
    }
}
