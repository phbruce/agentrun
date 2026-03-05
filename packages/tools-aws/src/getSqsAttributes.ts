// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { sqsClient as defaultClient } from "./_clients.js";

export function createGetSqsAttributes(client?: SQSClient) {
    const c = client ?? defaultClient;
    return tool(
        "get_sqs_attributes",
        "Get attributes of a specific SQS queue: approximate message count, visibility timeout, DLQ config, creation date.",
        {
            queueName: z.string().describe("Queue name or full queue URL")
        },
        async (args) => {
            let queueUrl = args.queueName;

            if (!queueUrl.startsWith("https://")) {
                const urlRes = await c.send(
                    new GetQueueUrlCommand({ QueueName: args.queueName })
                );
                queueUrl = urlRes.QueueUrl!;
            }

            const res = await c.send(
                new GetQueueAttributesCommand({
                    QueueUrl: queueUrl,
                    AttributeNames: ["All"]
                })
            );

            const attrs = res.Attributes ?? {};
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                queueUrl,
                                approximateMessages: Number(attrs.ApproximateNumberOfMessages ?? 0),
                                approximateMessagesNotVisible: Number(attrs.ApproximateNumberOfMessagesNotVisible ?? 0),
                                approximateMessagesDelayed: Number(attrs.ApproximateNumberOfMessagesDelayed ?? 0),
                                visibilityTimeoutSeconds: Number(attrs.VisibilityTimeout ?? 30),
                                messageRetentionSeconds: Number(attrs.MessageRetentionPeriod ?? 345600),
                                createdTimestamp: attrs.CreatedTimestamp
                                    ? new Date(Number(attrs.CreatedTimestamp) * 1000).toISOString()
                                    : null,
                                lastModifiedTimestamp: attrs.LastModifiedTimestamp
                                    ? new Date(Number(attrs.LastModifiedTimestamp) * 1000).toISOString()
                                    : null,
                                redrivePolicy: attrs.RedrivePolicy
                                    ? JSON.parse(attrs.RedrivePolicy)
                                    : null,
                                redriveAllowPolicy: attrs.RedriveAllowPolicy
                                    ? JSON.parse(attrs.RedriveAllowPolicy)
                                    : null
                            },
                            null,
                            2
                        )
                    }
                ]
            };
        }
    );
}

export const getSqsAttributes = createGetSqsAttributes();
