// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { projectId, clusterManagerClient } from "./_clients.js";

/** Default GKE cluster name, overridable via AGENTRUN_GKE_CLUSTER env var. */
const DEFAULT_CLUSTER = process.env.AGENTRUN_GKE_CLUSTER ?? "my-cluster";
/** Default GKE location, overridable via AGENTRUN_GKE_LOCATION env var. */
const DEFAULT_LOCATION = process.env.AGENTRUN_GKE_LOCATION ?? "us-central1";

export function createDescribeGkeCluster() {
    return tool(
        "describe_gke_cluster",
        "Get GKE cluster status, version, endpoint, node pools, and node count.",
        {
            clusterName: z
                .string()
                .default(DEFAULT_CLUSTER)
                .describe("GKE cluster name"),
            location: z
                .string()
                .default(DEFAULT_LOCATION)
                .describe("GKE cluster location (region or zone)"),
        },
        async (args) => {
            const client = clusterManagerClient();
            const name = `projects/${projectId}/locations/${args.location}/clusters/${args.clusterName}`;
            const [cluster] = await client.getCluster({ name });

            const nodeCount = (cluster.nodePools ?? []).reduce(
                (sum: number, np: any) => sum + (np.initialNodeCount ?? 0),
                0,
            );

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                name: cluster.name,
                                status: cluster.status,
                                version: cluster.currentMasterVersion,
                                nodeCount,
                                nodePools: (cluster.nodePools ?? []).map((np: any) => ({
                                    name: np.name,
                                    machineType: np.config?.machineType,
                                    nodeCount: np.initialNodeCount,
                                    status: np.status,
                                    version: np.version,
                                })),
                                endpoint: cluster.endpoint,
                                createTime: cluster.createTime,
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

export const describeGkeCluster = createDescribeGkeCluster();
