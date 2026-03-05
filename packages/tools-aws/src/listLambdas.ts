// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ListFunctionsCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { lambdaClient as defaultClient } from "./_clients.js";

export function createListLambdas(client?: LambdaClient) {
    const c = client ?? defaultClient;
    return tool(
        "list_lambdas",
        "List Lambda functions. Optionally filter by name substring. Returns function name, runtime, memory, timeout, last modified.",
        { nameFilter: z.string().optional().describe("Substring to filter function names") },
        async (args) => {
            const functions: any[] = [];
            let marker: string | undefined;
            do {
                const res = await c.send(
                    new ListFunctionsCommand({ Marker: marker, MaxItems: 50 })
                );
                for (const fn of res.Functions ?? []) {
                    if (!args.nameFilter || fn.FunctionName?.includes(args.nameFilter)) {
                        functions.push({
                            name: fn.FunctionName,
                            runtime: fn.Runtime,
                            memory: fn.MemorySize,
                            timeout: fn.Timeout,
                            lastModified: fn.LastModified
                        });
                    }
                }
                marker = res.NextMarker;
            } while (marker && functions.length < 200);

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ count: functions.length, functions }, null, 2)
                    }
                ]
            };
        }
    );
}

export const listLambdas = createListLambdas();
