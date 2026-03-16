// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DescribeClusterCommand, ListNodegroupsCommand, EKSClient } from "@aws-sdk/client-eks";
import { eksClient as defaultClient } from "./_clients.js";

/** Default cluster name, overridable via AGENTRUN_EKS_CLUSTER env var. */
const DEFAULT_CLUSTER = process.env.AGENTRUN_EKS_CLUSTER ?? "my-cluster";

export function createDescribeEksCluster(client?: EKSClient) {
    const c = client ?? defaultClient;
    return tool(
        "describe_eks_cluster",
        "Get EKS cluster status, version, endpoint, and nodegroup info.",
        {
            clusterName: z
                .string()
                .default(DEFAULT_CLUSTER)
                .describe("EKS cluster name")
        },
        async (args) => {
            const [clusterRes, ngRes] = await Promise.all([
                c.send(new DescribeClusterCommand({ name: args.clusterName })),
                c.send(new ListNodegroupsCommand({ clusterName: args.clusterName }))
            ]);
            const cluster = clusterRes.cluster;
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                name: cluster?.name,
                                status: cluster?.status,
                                version: cluster?.version,
                                platformVersion: cluster?.platformVersion,
                                endpoint: cluster?.endpoint,
                                nodegroups: ngRes.nodegroups,
                                createdAt: cluster?.createdAt
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

export const describeEksCluster = createDescribeEksCluster();
