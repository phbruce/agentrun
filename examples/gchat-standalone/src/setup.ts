// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register AWS providers, tools, and MCP server factory.
// Imported by index.ts before bootstrapping the platform.

import { setProviderRegistrar, registerToolFactory, setMcpServerFactory, getCatalog } from "@agentrun-ai/core";
import { registerAwsProviders } from "@agentrun-ai/aws";
import { createAwsTools } from "@agentrun-ai/tools-aws";
import { createGithubTools } from "@agentrun-ai/tools-github";
import { createJiraTools } from "@agentrun-ai/tools-jira";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
// @ts-ignore - subpath export requires moduleResolution: node16+
import { hydrateWorkflowAsTools } from "@agentrun-ai/tools-aws/declarative";

setProviderRegistrar(registerAwsProviders);

registerToolFactory((awsClients) => {
    const map = new Map();
    for (const t of [...createAwsTools(awsClients as any), ...createGithubTools(), ...createJiraTools()]) {
        map.set(t.name, t);
    }
    return map;
});

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
