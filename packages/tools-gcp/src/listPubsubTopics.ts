// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { pubsubClient } from "./_clients.js";

export function createListPubsubTopics() {
    return tool(
        "list_pubsub_topics",
        "List Pub/Sub topics in the project. Returns topic names and subscription counts.",
        {
            nameFilter: z.string().optional().describe("Substring to filter topic names"),
        },
        async (args) => {
            const pubsub = pubsubClient();
            const [allTopics] = await pubsub.getTopics();

            const topics: any[] = [];
            for (const topic of allTopics) {
                const name = topic.name?.split("/").pop() ?? topic.name;
                if (args.nameFilter && !name?.includes(args.nameFilter)) continue;

                const [subscriptions] = await topic.getSubscriptions();
                topics.push({
                    name,
                    subscriptionCount: subscriptions.length,
                });
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            { count: topics.length, topics },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}

export const listPubsubTopics = createListPubsubTopics();
