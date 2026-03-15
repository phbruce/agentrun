// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register GCP providers and tool factories.

import { setProviderRegistrar, registerToolFactory } from "@agentrun-ai/core";
import { registerGcpProviders } from "@agentrun-ai/gcp";
import { createAwsTools } from "@agentrun-ai/tools-aws";
import { createGithubTools } from "@agentrun-ai/tools-github";
import { createJiraTools } from "@agentrun-ai/tools-jira";

// Register GCP providers (Vertex AI for LLM, Firestore for sessions, Cloud Storage for manifests).
setProviderRegistrar(registerGcpProviders);

// Register tool factory — creates tool instances when clients are available.
registerToolFactory((clients) => {
    const map = new Map();
    for (const tool of [
        ...createAwsTools(clients as any),
        ...createGithubTools(),
        ...createJiraTools(),
    ]) {
        map.set(tool.name, tool);
    }
    return map;
});
