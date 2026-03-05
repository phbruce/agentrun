// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ListQueuesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { sqsClient as defaultClient } from "./_clients.js";

export function createListSqsQueues(client?: SQSClient) {
    const c = client ?? defaultClient;
    return tool(
        "list_sqs_queues",
        "List SQS queues. Optionally filter by name prefix. Returns queue URLs and names.",
        {
            namePrefix: z.string().optional().describe("Queue name prefix to filter")
        },
        async (args) => {
            const queues: string[] = [];
            let nextToken: string | undefined;
            do {
                const res = await c.send(
                    new ListQueuesCommand({
                        QueueNamePrefix: args.namePrefix,
                        MaxResults: 100,
                        NextToken: nextToken
                    })
                );
                for (const url of res.QueueUrls ?? []) {
                    queues.push(url);
                }
                nextToken = res.NextToken;
            } while (nextToken && queues.length < 500);

            const summary = queues.map((url) => {
                const name = url.split("/").pop() ?? url;
                return { name, url };
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ count: summary.length, queues: summary }, null, 2)
                    }
                ]
            };
        }
    );
}

export const listSqsQueues = createListSqsQueues();
