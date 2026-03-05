// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FilterLogEventsCommand, CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { cwlClient as defaultClient } from "./_clients.js";

export function createSearchCloudwatchLogs(client?: CloudWatchLogsClient) {
    const c = client ?? defaultClient;
    return tool(
        "search_cloudwatch_logs",
        "Search CloudWatch logs for a pattern in a specific log group. Returns up to 50 matching events from the last N hours.",
        {
            logGroupName: z.string().describe("CloudWatch log group name"),
            filterPattern: z.string().describe("CloudWatch filter pattern (e.g., 'ERROR', '\"timeout\"')"),
            hoursBack: z.number().default(1).describe("How many hours back to search (default: 1)")
        },
        async (args) => {
            const startTime = Date.now() - args.hoursBack * 60 * 60 * 1000;
            const res = await c.send(
                new FilterLogEventsCommand({
                    logGroupName: args.logGroupName,
                    filterPattern: args.filterPattern,
                    startTime,
                    limit: 50
                })
            );
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                count: res.events?.length ?? 0,
                                events: (res.events ?? []).map((e) => ({
                                    timestamp: new Date(e.timestamp!).toISOString(),
                                    message: e.message?.slice(0, 500)
                                }))
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

export const searchCloudwatchLogs = createSearchCloudwatchLogs();
