// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register AWS providers, tools, and MCP server factory before platform bootstrap.
// This file is imported (side-effect) by each handler to ensure registration runs once
// during Lambda cold start, before bootstrapPlatform() is called.

import { setProviderRegistrar, registerToolFactory, setMcpServerFactory, getCatalog } from "@agentrun-ai/core";
import { registerAwsProviders } from "@agentrun-ai/aws";
import { createAwsTools } from "@agentrun-ai/tools-aws";
import { createGithubTools } from "@agentrun-ai/tools-github";
import { createJiraTools } from "@agentrun-ai/tools-jira";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
// @ts-ignore - subpath export requires moduleResolution: node16+
import { hydrateWorkflowAsTools } from "@agentrun-ai/tools-aws/declarative";

// 1. Tell the platform how to register infrastructure providers (Bedrock, DynamoDB,
//    S3, SQS, STS, Secrets Manager) from the platform config YAML.
setProviderRegistrar(registerAwsProviders);

// 2. Register a tool factory that creates tool instances once AWS clients are available.
//    The factory receives scoped AWS clients (from STS AssumeRole) and returns a Map
//    of tool name -> tool handler. These tools become available to the agent and to the
//    MCP server's tools/list + tools/call endpoints.
registerToolFactory((awsClients) => {
    const map = new Map();
    for (const tool of [
        ...createAwsTools(awsClients as any),
        ...createGithubTools(),
        ...createJiraTools(),
    ]) {
        map.set(tool.name, tool);
    }
    return map;
});

// 3. Register MCP server factory for Claude Code CLI integration.
setMcpServerFactory((awsClients) => {
    const baseTools: any[] = [...createAwsTools(awsClients as any), ...createGithubTools(), ...createJiraTools()];

    try {
        const catalog = getCatalog();
        const workflowTools = hydrateWorkflowAsTools(catalog, new Map());
        for (const [name, wfTool] of workflowTools) {
            baseTools.push(tool(name, (wfTool as any).description || name, {}, async (args: any) => {
                return wfTool.handler(args, null);
            }));
        }
    } catch { /* catalog not loaded yet */ }

    return createSdkMcpServer({
        name: "infra-tools",
        tools: baseTools,
    });
});
