// SPDX-License-Identifier: AGPL-3.0-only

import { logger, PlatformRegistry } from "@agentrun-ai/core";
import type { PlatformConfig } from "@agentrun-ai/core";
import { VertexAiLlmProvider } from "./vertexLlm.js";
import { VertexAiEmbeddingProvider } from "./vertexEmbeddings.js";
import { FirestoreSessionStore } from "./firestoreSession.js";
import { FirestoreUsageStore } from "./firestoreUsage.js";
import { GcsManifestStore } from "./gcsManifests.js";
import { GcpSecretProvider } from "./secretManager.js";
import { PubSubQueueProvider } from "./pubsubQueue.js";
import { GcpIamCredentialProvider } from "./iamCredentials.js";
import { CloudSqlVectorStore } from "./cloudSqlVector.js";
import { VertexAiKBProvider } from "./vertexKB.js";

/**
 * Register all GCP provider implementations into the PlatformRegistry.
 *
 * Call once during cold start (e.g. Cloud Function init). All provider settings
 * are read from the PlatformConfig, with sensible defaults where possible.
 */
export function registerGcpProviders(config: PlatformConfig): void {
    const registry = PlatformRegistry.instance();
    const { providers } = config.spec;

    const projectId = (providers.llm.config.projectId as string) ?? "";
    const llmLocation = (providers.llm.config.location as string) ?? "us-east5";
    const credPattern = providers.credentials.config.saEmailPattern as string;
    const sessionCollection = (providers.session.config.collectionName as string) ?? "agentrun-sessions";
    const sessionTtlDays = (providers.session.config.ttlDays as number) ?? 7;
    const usageCollection = (providers.usage.config.collectionName as string) ?? "agentrun-usage";
    const manifestsBucket = providers.manifests.config.bucket as string;
    const queueProjectId = (providers.queue.config.projectId as string) ?? projectId;
    const queueTopicPrefix = (providers.queue.config.topicPrefix as string) ?? "";
    const secretsProjectId = (providers.secrets?.config.projectId as string) ?? projectId;

    // RAG providers (optional — only if configured)
    const embeddingsConfig = providers.embeddings;
    const vectorStoreConfig = providers.vectorStore;

    const embeddingsProvider = embeddingsConfig
        ? new VertexAiEmbeddingProvider(
            (embeddingsConfig.config.projectId as string) ?? projectId,
            (embeddingsConfig.config.location as string) ?? "us-central1",
            (embeddingsConfig.config.model as string) ?? "text-embedding-005",
            (embeddingsConfig.config.dimensions as number) ?? 768,
        )
        : undefined;

    const vectorStoreProvider = vectorStoreConfig
        ? new CloudSqlVectorStore(
            vectorStoreConfig.config.connectionString as string,
            (vectorStoreConfig.config.schema as string) ?? "agentrun",
        )
        : undefined;

    // Knowledge Base provider (optional — managed RAG via Vertex AI Agent Builder)
    const kbConfig = providers.knowledgeBase;
    const knowledgeBaseProvider = kbConfig
        ? new VertexAiKBProvider(
            (kbConfig.config.projectId as string) ?? projectId,
            (kbConfig.config.location as string) ?? "global",
            kbConfig.config.datastoreId as string,
        )
        : undefined;

    registry.register({
        llm: new VertexAiLlmProvider(projectId, llmLocation),
        credentials: new GcpIamCredentialProvider(projectId, credPattern),
        sessions: new FirestoreSessionStore(sessionCollection, sessionTtlDays),
        usage: new FirestoreUsageStore(usageCollection),
        manifests: new GcsManifestStore(manifestsBucket),
        queue: new PubSubQueueProvider(queueProjectId, queueTopicPrefix),
        secrets: new GcpSecretProvider(secretsProjectId),
        embeddings: embeddingsProvider,
        vectorStore: vectorStoreProvider,
        knowledgeBase: knowledgeBaseProvider,
    });

    registry.setConfig(config);

    logger.info({ name: config.metadata.name }, "GCP providers registered");
}

// Re-export all provider classes for direct use
export { VertexAiLlmProvider } from "./vertexLlm.js";
export { VertexAiEmbeddingProvider } from "./vertexEmbeddings.js";
export { FirestoreSessionStore } from "./firestoreSession.js";
export { FirestoreUsageStore } from "./firestoreUsage.js";
export { GcsManifestStore } from "./gcsManifests.js";
export { GcpSecretProvider } from "./secretManager.js";
export { PubSubQueueProvider } from "./pubsubQueue.js";
export { GcpIamCredentialProvider } from "./iamCredentials.js";
export { CloudSqlVectorStore } from "./cloudSqlVector.js";
export { VertexAiKBProvider } from "./vertexKB.js";
