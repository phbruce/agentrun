// SPDX-License-Identifier: AGPL-3.0-only
import type {
    LlmProvider,
    CredentialProvider,
    SessionStore,
    UsageStore,
    ManifestStore,
    QueueProvider,
    BootstrapSecretProvider,
    PlatformConfig,
    EmbeddingProvider,
    VectorStore,
    KnowledgeBaseProvider,
    UserTokenStore,
} from "./types.js";

export interface PlatformProviders {
    llm: LlmProvider;
    credentials: CredentialProvider;
    sessions: SessionStore;
    usage: UsageStore;
    manifests: ManifestStore;
    queue: QueueProvider;
    secrets: BootstrapSecretProvider;
    embeddings?: EmbeddingProvider;
    vectorStore?: VectorStore;
    knowledgeBase?: KnowledgeBaseProvider;
    userTokens?: UserTokenStore;
}

let _instance: PlatformRegistry | null = null;

export class PlatformRegistry {
    private providers: PlatformProviders | null = null;
    private _config: PlatformConfig | null = null;

    static instance(): PlatformRegistry {
        if (!_instance) {
            _instance = new PlatformRegistry();
        }
        return _instance;
    }

    /** Reset singleton (for testing). */
    static reset(): void {
        _instance = null;
    }

    register(providers: PlatformProviders): void {
        this.providers = providers;
    }

    setConfig(config: PlatformConfig): void {
        this._config = config;
    }

    get config(): PlatformConfig {
        if (!this._config) throw new Error("PlatformRegistry: config not loaded. Call loadPlatformConfig() first.");
        return this._config;
    }

    get isConfigured(): boolean {
        return this._config !== null && this.providers !== null;
    }

    get llm(): LlmProvider {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.llm;
    }

    get credentials(): CredentialProvider {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.credentials;
    }

    get sessions(): SessionStore {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.sessions;
    }

    get usage(): UsageStore {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.usage;
    }

    get manifests(): ManifestStore {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.manifests;
    }

    get queue(): QueueProvider {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.queue;
    }

    get bootstrapSecrets(): BootstrapSecretProvider {
        if (!this.providers) throw new Error("PlatformRegistry: providers not registered.");
        return this.providers.secrets;
    }

    get embeddings(): EmbeddingProvider | null {
        return this.providers?.embeddings ?? null;
    }

    get vectorStore(): VectorStore | null {
        return this.providers?.vectorStore ?? null;
    }

    get knowledgeBase(): KnowledgeBaseProvider | null {
        return this.providers?.knowledgeBase ?? null;
    }

    get userTokens(): UserTokenStore | null {
        return this.providers?.userTokens ?? null;
    }
}
