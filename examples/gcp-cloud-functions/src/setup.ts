// SPDX-License-Identifier: AGPL-3.0-only

// Setup: register providers and tool factories.
//
// NOTE: This example uses @agentrun-oss/aws providers (Bedrock, DynamoDB, S3)
// even on GCP. For a fully GCP-native deployment, implement the provider
// interfaces from @agentrun-oss/core and register them via PlatformRegistry.
// See the README for a custom providers example.

import { setProviderRegistrar, registerToolFactory } from "@agentrun-oss/core";
import { registerAwsProviders } from "@agentrun-oss/aws";
import { createAwsTools } from "@agentrun-oss/tools-aws";
import { createGithubTools } from "@agentrun-oss/tools-github";
import { createJiraTools } from "@agentrun-oss/tools-jira";

// Register AWS providers (Bedrock for LLM, DynamoDB for sessions, S3 for manifests).
// Replace with GCP-native providers when @agentrun-oss/gcp is available.
setProviderRegistrar(registerAwsProviders);

// Register tool factory — creates tool instances when AWS clients are available.
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
