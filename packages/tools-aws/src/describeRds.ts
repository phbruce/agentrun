// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DescribeDBClustersCommand, DescribeDBProxiesCommand, RDSClient } from "@aws-sdk/client-rds";
import { rdsClient as defaultClient } from "./_clients.js";

/** Default RDS cluster identifier, overridable via env var. */
const DEFAULT_CLUSTER_ID = process.env.AGENTRUN_RDS_CLUSTER_ID ?? "";
/** Default RDS Proxy name, overridable via env var. */
const DEFAULT_PROXY_NAME = process.env.AGENTRUN_RDS_PROXY_NAME ?? "";

export function createDescribeRds(client?: RDSClient) {
    const c = client ?? defaultClient;
    return tool(
        "describe_rds",
        "Get Aurora PostgreSQL cluster and RDS Proxy status.",
        {
            clusterId: z.string().default(DEFAULT_CLUSTER_ID).describe("DB cluster identifier"),
            proxyName: z.string().default(DEFAULT_PROXY_NAME).describe("RDS Proxy name"),
        },
        async (args) => {
            const promises: Promise<any>[] = [];

            if (args.clusterId) {
                promises.push(
                    c.send(new DescribeDBClustersCommand({ DBClusterIdentifier: args.clusterId }))
                );
            } else {
                promises.push(c.send(new DescribeDBClustersCommand({})));
            }

            if (args.proxyName) {
                promises.push(
                    c.send(new DescribeDBProxiesCommand({ DBProxyName: args.proxyName }))
                );
            } else {
                promises.push(c.send(new DescribeDBProxiesCommand({})));
            }

            const [clustersRes, proxiesRes] = await Promise.all(promises);
            const cluster = clustersRes.DBClusters?.[0];
            const proxy = proxiesRes.DBProxies?.[0];
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                cluster: {
                                    id: cluster?.DBClusterIdentifier,
                                    status: cluster?.Status,
                                    engine: cluster?.Engine,
                                    engineVersion: cluster?.EngineVersion,
                                    members: cluster?.DBClusterMembers?.map((m: any) => ({
                                        id: m.DBInstanceIdentifier,
                                        isWriter: m.IsClusterWriter
                                    })),
                                    endpoint: cluster?.Endpoint,
                                    readerEndpoint: cluster?.ReaderEndpoint
                                },
                                proxy: {
                                    name: proxy?.DBProxyName,
                                    status: proxy?.Status,
                                    endpoint: proxy?.Endpoint,
                                    engineFamily: proxy?.EngineFamily
                                }
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

export const describeRds = createDescribeRds();
