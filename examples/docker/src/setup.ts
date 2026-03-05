// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register AWS providers and tool factories.
// Uses Bedrock for LLM even in Docker — configure AWS credentials in .env.
// For fully self-hosted LLM, implement the LlmProvider interface from @agentrun-oss/core.

import { setProviderRegistrar, registerToolFactory } from "@agentrun-oss/core";
import { registerAwsProviders } from "@agentrun-oss/aws";
import { createAwsTools } from "@agentrun-oss/tools-aws";
import { createGithubTools } from "@agentrun-oss/tools-github";
import { createJiraTools } from "@agentrun-oss/tools-jira";

setProviderRegistrar(registerAwsProviders);

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
