// SPDX-License-Identifier: AGPL-3.0-only

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { UsageStore, MonthlyUsage } from "@agentrun-oss/core";

export class DynamoUsageStore implements UsageStore {
    private client: DynamoDBDocumentClient;
    private table: string;

    constructor(tableName: string) {
        this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
        this.table = tableName;
    }

    private currentMonth(): string {
        return new Date().toISOString().slice(0, 7);
    }

    async track(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
        await this.client.send(
            new UpdateCommand({
                TableName: this.table,
                Key: { userId, month: this.currentMonth() },
                UpdateExpression: "ADD inputTokens :i, outputTokens :o, queryCount :one",
                ExpressionAttributeValues: {
                    ":i": inputTokens,
                    ":o": outputTokens,
                    ":one": 1,
                },
            }),
        );
    }

    async getMonthly(userId: string): Promise<MonthlyUsage> {
        const result = await this.client.send(
            new GetCommand({
                TableName: this.table,
                Key: { userId, month: this.currentMonth() },
            }),
        );

        return {
            inputTokens: result.Item?.inputTokens ?? 0,
            outputTokens: result.Item?.outputTokens ?? 0,
            queryCount: result.Item?.queryCount ?? 0,
        };
    }
}
