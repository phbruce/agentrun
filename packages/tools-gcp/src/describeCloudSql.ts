// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { projectId, sqlAdminClient } from "./_clients.js";

/** Default Cloud SQL instance name, overridable via AGENTRUN_CLOUD_SQL_INSTANCE env var. */
const DEFAULT_INSTANCE = process.env.AGENTRUN_CLOUD_SQL_INSTANCE ?? "";

export function createDescribeCloudSql() {
    return tool(
        "describe_cloud_sql",
        "Get Cloud SQL instance status, version, tier, region, IP addresses, and backup configuration.",
        {
            instanceName: z
                .string()
                .default(DEFAULT_INSTANCE)
                .describe("Cloud SQL instance name"),
        },
        async (args) => {
            const client = sqlAdminClient();

            if (args.instanceName) {
                const [instance] = await client.get({
                    project: projectId,
                    instance: args.instanceName,
                });
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    name: instance.name,
                                    state: instance.state,
                                    databaseVersion: instance.databaseVersion,
                                    tier: instance.settings?.tier,
                                    region: instance.region,
                                    ipAddresses: (instance.ipAddresses ?? []).map((ip: any) => ({
                                        type: ip.type,
                                        ipAddress: ip.ipAddress,
                                    })),
                                    backupEnabled: instance.settings?.backupConfiguration?.enabled ?? false,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            }

            // List all instances if no specific instance provided
            const [response] = await client.list({ project: projectId });
            const instances = (response.items ?? []).map((instance: any) => ({
                name: instance.name,
                state: instance.state,
                databaseVersion: instance.databaseVersion,
                tier: instance.settings?.tier,
                region: instance.region,
                ipAddresses: (instance.ipAddresses ?? []).map((ip: any) => ({
                    type: ip.type,
                    ipAddress: ip.ipAddress,
                })),
                backupEnabled: instance.settings?.backupConfiguration?.enabled ?? false,
            }));

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            { count: instances.length, instances },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );
}

export const describeCloudSql = createDescribeCloudSql();
