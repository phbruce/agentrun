// SPDX-License-Identifier: AGPL-3.0-only

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createHash } from "crypto";
import type { QueueProvider } from "@agentrun-ai/core";

/**
 * SQS-backed QueueProvider.
 *
 * Queue names are derived by applying a configurable naming pattern.
 * By default, the pattern `{prefix}{sha1}` hashes the logical queue name
 * with SHA-1 and prepends the configured prefix.
 *
 * @param region     - AWS region for SQS
 * @param accountId  - AWS account ID for building queue URLs
 * @param namePrefix - Prefix prepended to the SHA-1 hash of the queue name
 */
export class SqsQueueProvider implements QueueProvider {
    private client: SQSClient;
    private region: string;
    private accountId: string;
    private namePrefix: string;

    constructor(region: string, accountId: string, namePrefix = "") {
        this.client = new SQSClient({ region });
        this.region = region;
        this.accountId = accountId;
        this.namePrefix = namePrefix;
    }

    async send(queueName: string, payload: Record<string, unknown>): Promise<void> {
        const hash = createHash("sha1").update(queueName).digest("hex");
        const awsQueueName = `${this.namePrefix}${hash}`;
        const queueUrl = `https://sqs.${this.region}.amazonaws.com/${this.accountId}/${awsQueueName}`;

        await this.client.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(payload),
        }));
    }
}
