// SPDX-License-Identifier: AGPL-3.0-only

import { logger, PlatformRegistry } from "@agentrun-ai/core";
import type { PlatformConfig } from "@agentrun-ai/core";
import { BedrockLlmProvider } from "./bedrockLlm.js";
import { BedrockEmbeddingProvider } from "./bedrockEmbeddings.js";
import { DynamoSessionStore } from "./dynamoSession.js";
import { DynamoUsageStore } from "./dynamoUsage.js";
import { S3ManifestStore } from "./s3Manifests.js";
import { SmBootstrapProvider } from "./smBootstrap.js";
import { SqsQueueProvider } from "./sqsQueue.js";
import { StsCredentialProvider } from "./stsCredentials.js";
import { PgVectorStore } from "./pgVectorStore.js";
import { BedrockKBProvider } from "./bedrockKB.js";

/**
 * Register all AWS provider implementations into the PlatformRegistry.
 *
 * Call once during cold start (e.g. Lambda init). All provider settings
 * are read from the PlatformConfig, with sensible defaults where possible.
 */
export function registerAwsProviders(config: PlatformConfig): void {
    const registry = PlatformRegistry.instance();
    const { providers } = config.spec;

    const llmRegion = (providers.llm.config.region as string) ?? "us-east-1";
    const credRegion = (providers.credentials.config.region as string) ?? "us-east-1";
    const credPattern = providers.credentials.config.roleArnPattern as string;
    const sessionTable = providers.session.config.tableName as string;
    const sessionTtlDays = (providers.session.config.ttlDays as number) ?? 7;
    const usageTable = providers.usage.config.tableName as string;
    const manifestsBucket = providers.manifests.config.bucket as string;
    const queueRegion = (providers.queue.config.region as string) ?? "us-east-1";
    const queueAccountId = providers.queue.config.accountId as string;
    const queueNamePrefix = (providers.queue.config.namePrefix as string) ?? "";

    // RAG providers (optional — only if configured)
    const embeddingsConfig = providers.embeddings;
    const vectorStoreConfig = providers.vectorStore;

    const embeddingsProvider = embeddingsConfig
        ? new BedrockEmbeddingProvider(
            (embeddingsConfig.config.region as string) ?? llmRegion,
            (embeddingsConfig.config.model as string) ?? "amazon.titan-embed-text-v2:0",
            (embeddingsConfig.config.dimensions as number) ?? 1024,
        )
        : undefined;

    const vectorStoreProvider = vectorStoreConfig
        ? new PgVectorStore(
            (vectorStoreConfig.config.region as string) ?? "us-east-1",
            vectorStoreConfig.config.clusterArn as string,
            vectorStoreConfig.config.secretArn as string,
            vectorStoreConfig.config.database as string,
            (vectorStoreConfig.config.schema as string) ?? "agentrun",
        )
        : undefined;

    // Knowledge Base provider (optional — managed RAG via Bedrock KB)
    const kbConfig = providers.knowledgeBase;
    const knowledgeBaseProvider = kbConfig
        ? new BedrockKBProvider(
            (kbConfig.config.region as string) ?? llmRegion,
            kbConfig.config.knowledgeBaseId as string,
        )
        : undefined;

    registry.register({
        llm: new BedrockLlmProvider(llmRegion),
        credentials: new StsCredentialProvider(credRegion, credPattern),
        sessions: new DynamoSessionStore(sessionTable, sessionTtlDays),
        usage: new DynamoUsageStore(usageTable),
        manifests: new S3ManifestStore(manifestsBucket),
        queue: new SqsQueueProvider(queueRegion, queueAccountId, queueNamePrefix),
        secrets: new SmBootstrapProvider(),
        embeddings: embeddingsProvider,
        vectorStore: vectorStoreProvider,
        knowledgeBase: knowledgeBaseProvider,
    });

    registry.setConfig(config);

    logger.info({ name: config.metadata.name }, "AWS providers registered");
}

// Re-export all provider classes for direct use
export { BedrockLlmProvider } from "./bedrockLlm.js";
export { BedrockEmbeddingProvider } from "./bedrockEmbeddings.js";
export { DynamoSessionStore } from "./dynamoSession.js";
export { DynamoUsageStore } from "./dynamoUsage.js";
export { S3ManifestStore } from "./s3Manifests.js";
export { SmBootstrapProvider } from "./smBootstrap.js";
export { SqsQueueProvider } from "./sqsQueue.js";
export { StsCredentialProvider } from "./stsCredentials.js";
export { PgVectorStore } from "./pgVectorStore.js";
export { BedrockKBProvider } from "./bedrockKB.js";
