// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { functionsClient, redactEnvVars } from "./_clients.js";

export function createGetCloudFunctionDetails() {
    return tool(
        "get_cloud_function_details",
        "Get detailed configuration of a specific Cloud Function. Environment variables with sensitive keys are redacted.",
        {
            functionName: z
                .string()
                .describe("Full Cloud Function resource name (projects/*/locations/*/functions/*)"),
        },
        async (args) => {
            const client = functionsClient();
            const [fn] = await client.getFunction({ name: args.functionName });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                name: fn.name,
                                runtime: fn.runtime,
                                entryPoint: fn.entryPoint,
                                status: fn.status,
                                memory: fn.availableMemoryMb,
                                timeout: fn.timeout,
                                envVars: redactEnvVars(
                                    fn.environmentVariables as Record<string, string>,
                                ),
                                trigger: fn.httpsTrigger
                                    ? { type: "https", url: fn.httpsTrigger.url }
                                    : fn.eventTrigger
                                      ? {
                                            type: "event",
                                            eventType: fn.eventTrigger.eventType,
                                            resource: fn.eventTrigger.resource,
                                        }
                                      : null,
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

export const getCloudFunctionDetails = createGetCloudFunctionDetails();
