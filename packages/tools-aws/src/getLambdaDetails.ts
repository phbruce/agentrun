// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { lambdaClient as defaultClient, redactEnvVars } from "./_clients.js";

export function createGetLambdaDetails(client?: LambdaClient) {
    const c = client ?? defaultClient;
    return tool(
        "get_lambda_details",
        "Get detailed configuration of a specific Lambda function. Environment variables with sensitive keys are redacted.",
        { functionName: z.string().describe("Full Lambda function name") },
        async (args) => {
            const res = await c.send(
                new GetFunctionCommand({ FunctionName: args.functionName })
            );
            const config = res.Configuration;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                name: config?.FunctionName,
                                runtime: config?.Runtime,
                                handler: config?.Handler,
                                memory: config?.MemorySize,
                                timeout: config?.Timeout,
                                lastModified: config?.LastModified,
                                codeSize: config?.CodeSize,
                                layers: config?.Layers?.map((l) => l.Arn),
                                vpcConfig: config?.VpcConfig
                                    ? {
                                          subnetIds: config.VpcConfig.SubnetIds,
                                          securityGroupIds: config.VpcConfig.SecurityGroupIds
                                      }
                                    : null,
                                envVars: redactEnvVars(
                                    config?.Environment?.Variables as Record<string, string>
                                )
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

export const getLambdaDetails = createGetLambdaDetails();
