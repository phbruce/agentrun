// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { projectId, functionsClient } from "./_clients.js";

export function createListCloudFunctions() {
    return tool(
        "list_cloud_functions",
        "List Cloud Functions in the project. Returns function name, runtime, status, entry point, and last update time.",
        {
            nameFilter: z.string().optional().describe("Substring to filter function names"),
        },
        async (args) => {
            const client = functionsClient();
            const parent = `projects/${projectId}/locations/-`;
            const [response] = await client.listFunctions({ parent });

            const functions: any[] = [];
            for (const fn of response ?? []) {
                const name = fn.name?.split("/").pop() ?? fn.name;
                if (!args.nameFilter || name?.includes(args.nameFilter)) {
                    functions.push({
                        name,
                        runtime: fn.runtime,
                        status: fn.status,
                        entryPoint: fn.entryPoint,
                        updateTime: fn.updateTime,
                    });
                }
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            { count: functions.length, functions },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}

export const listCloudFunctions = createListCloudFunctions();
