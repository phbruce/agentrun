// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register AWS providers and tool factories.
// Imported by index.ts before bootstrapping the platform.

import { setProviderRegistrar, registerToolFactory } from "@agentrun-ai/core";
import { registerAwsProviders } from "@agentrun-ai/aws";
import { createAwsTools } from "@agentrun-ai/tools-aws";
import { createGithubTools } from "@agentrun-ai/tools-github";
import { createJiraTools } from "@agentrun-ai/tools-jira";

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
