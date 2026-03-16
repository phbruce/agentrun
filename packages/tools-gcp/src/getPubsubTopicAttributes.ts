// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { pubsubClient } from "./_clients.js";

export function createGetPubsubTopicAttributes() {
    return tool(
        "get_pubsub_topic_attributes",
        "Get Pub/Sub topic details and its subscriptions with ack deadline, message retention, and dead letter config.",
        {
            topicName: z.string().describe("Pub/Sub topic name (short name or full resource path)"),
        },
        async (args) => {
            const pubsub = pubsubClient();
            const topic = pubsub.topic(args.topicName);
            const [topicMetadata] = await topic.getMetadata();
            const [subscriptions] = await topic.getSubscriptions();

            const subs: any[] = [];
            for (const sub of subscriptions) {
                const [metadata] = await sub.getMetadata();
                subs.push({
                    name: metadata.name?.split("/").pop() ?? metadata.name,
                    ackDeadlineSeconds: metadata.ackDeadlineSeconds,
                    messageRetentionDuration: metadata.messageRetentionDuration?.seconds
                        ? `${metadata.messageRetentionDuration.seconds}s`
                        : null,
                    deadLetterTopic: metadata.deadLetterPolicy?.deadLetterTopic
                        ? metadata.deadLetterPolicy.deadLetterTopic.split("/").pop()
                        : null,
                });
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                topicName: topicMetadata.name?.split("/").pop() ?? topicMetadata.name,
                                subscriptions: subs,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}

export const getPubsubTopicAttributes = createGetPubsubTopicAttributes();
