// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { loggingClient } from "./_clients.js";

export function createSearchCloudLogging() {
    return tool(
        "search_cloud_logging",
        "Search Cloud Logging for entries matching a filter. Returns up to 50 matching entries from the last N hours.",
        {
            filter: z
                .string()
                .describe('Cloud Logging filter string (e.g., \'severity>=ERROR\', \'resource.type="cloud_function"\')'),
            hoursBack: z
                .number()
                .default(1)
                .describe("How many hours back to search (default: 1)"),
        },
        async (args) => {
            const logging = loggingClient();
            const cutoff = new Date(Date.now() - args.hoursBack * 60 * 60 * 1000).toISOString();
            const fullFilter = `${args.filter} AND timestamp>="${cutoff}"`;

            const [entries] = await logging.getEntries({
                filter: fullFilter,
                pageSize: 50,
                orderBy: "timestamp desc",
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                count: entries.length,
                                entries: entries.map((entry: any) => ({
                                    timestamp: entry.metadata?.timestamp ?? entry.timestamp,
                                    severity: entry.metadata?.severity ?? entry.severity,
                                    message:
                                        typeof entry.data === "string"
                                            ? entry.data.slice(0, 500)
                                            : JSON.stringify(entry.data)?.slice(0, 500),
                                })),
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

export const searchCloudLogging = createSearchCloudLogging();
