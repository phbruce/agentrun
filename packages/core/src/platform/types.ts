// SPDX-License-Identifier: AGPL-3.0-only
// ── LLM Provider ──

export interface ToolResultInput {
    toolName: string;
    result: string;
}

export interface LlmResponse {
    answer: string;
    inputTokens: number;
    outputTokens: number;
}

export interface LlmProvider {
    summarize(
        systemPrompt: string,
        userPrompt: string,
        toolResults: ToolResultInput[],
        model: string,
    ): Promise<LlmResponse>;
}

// ── Credential Provider ──

export interface CredentialProvider {
    /** Returns scoped credentials for a role. Shape is provider-specific (opaque to core). */
    getCredentials(role: string): Promise<unknown>;
}

// ── Session Store ──

export interface SessionMessage {
    role: "user" | "assistant";
    content: string;
}

export interface SessionStore {
    saveMessage(sessionId: string, ts: string, role: "user" | "assistant", content: string, userId: string): Promise<void>;
    getHistory(sessionId: string): Promise<SessionMessage[]>;
}

// ── Usage Store ──

export interface MonthlyUsage {
    inputTokens: number;
    outputTokens: number;
    queryCount: number;
}

export interface UsageStore {
    track(userId: string, inputTokens: number, outputTokens: number): Promise<void>;
    getMonthly(userId: string): Promise<MonthlyUsage>;
}

// ── Manifest Store ──

export interface ManifestStore {
    listFiles(prefix: string): Promise<string[]>;
    getFile(key: string): Promise<string | null>;
    putFile?(key: string, content: string): Promise<void>;
    deleteFile?(key: string): Promise<void>;
}

// ── Queue Provider ──

export interface QueueProvider {
    send(queueName: string, payload: Record<string, unknown>): Promise<void>;
}

// ── Bootstrap Secret Provider ──

export interface BootstrapSecretProvider {
    getSecretValue(secretArn: string): Promise<Record<string, string>>;
}

// ── Embedding Provider (RAG) ──

export interface EmbeddingResult {
    vector: number[];
    model: string;
    inputTokens: number;
}

export interface EmbeddingProvider {
    embed(text: string): Promise<EmbeddingResult>;
    embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
    dimensions(): number;
}

// ── Vector Store (RAG) ──

export interface VectorChunk {
    id: string;
    content: string;
    metadata: Record<string, string>;
    similarity: number;
}

export interface VectorStore {
    search(vector: number[], topK: number, filter?: Record<string, string>): Promise<VectorChunk[]>;
    upsert(chunks: { id: string; content: string; vector: number[]; metadata: Record<string, string> }[]): Promise<number>;
    delete(ids: string[]): Promise<number>;
}

// ── Knowledge Base Provider (Managed RAG) ──

export interface KnowledgeBaseSearchResult {
    id: string;
    content: string;
    score: number;
    metadata: Record<string, string>;
    location?: { type: string; s3Location?: { uri: string } };
}

export interface KnowledgeBaseProvider {
    retrieve(query: string, topK: number, filter?: Record<string, string>): Promise<KnowledgeBaseSearchResult[]>;
}

// ── Document Ingester (RAG) ──

export interface DocumentChunk {
    id: string;
    content: string;
    metadata: Record<string, string>;
}

export interface DocumentIngester {
    chunk(source: string, content: string): DocumentChunk[];
}

// ── User Token Store (per-user OAuth / PAT credentials) ──

export interface UserToken {
    /** Access token or PAT value */
    accessToken: string;
    /** Refresh token (OAuth2 only) */
    refreshToken?: string;
    /** OpenID Connect ID token (JWT proving user identity, for GenAI Gateway etc.) */
    idToken?: string;
    /** Token expiration timestamp (ms since epoch) */
    expiresAt?: number;
    /** Token type: bearer (OAuth2), basic, or pat */
    tokenType: "bearer" | "basic" | "pat";
    /** OAuth2 scopes granted */
    scopes?: string[];
    /** When the token was saved */
    savedAt: number;
}

export interface AuthProviderConfig {
    /** Authentication method: OAuth2 redirect flow or manual PAT entry */
    type: "oauth2" | "pat";
    /** OAuth2 authorization URL */
    authUrl?: string;
    /** OAuth2 token exchange URL */
    tokenUrl?: string;
    /** Secret name for OAuth2 client ID */
    clientIdSecret?: string;
    /** Secret name for OAuth2 client secret */
    clientSecretSecret?: string;
    /** OAuth2 scopes to request */
    scopes?: string[];
    /** Human-readable instructions for PAT creation */
    instructions?: string;
    /** Tool categories that use this provider (e.g. ["jira", "confluence"]) */
    services: string[];
}

export interface UserTokenStore {
    /** Get a user's token for a given auth provider */
    getToken(userId: string, provider: string): Promise<UserToken | null>;
    /** Save a user's token for a given auth provider */
    saveToken(userId: string, provider: string, token: UserToken): Promise<void>;
    /** Delete a user's token for a given auth provider */
    deleteToken(userId: string, provider: string): Promise<void>;
    /** List which auth providers a user has connected */
    listProviders(userId: string): Promise<string[]>;
}

// ── Platform Config ──

export interface ProviderConfig {
    type: string;
    config: Record<string, unknown>;
}

export interface ProviderConfigs {
    llm: ProviderConfig;
    credentials: ProviderConfig;
    session: ProviderConfig;
    usage: ProviderConfig;
    manifests: ProviderConfig;
    queue: ProviderConfig;
    secrets: ProviderConfig;
    embeddings?: ProviderConfig;
    vectorStore?: ProviderConfig;
    knowledgeBase?: ProviderConfig;
    userTokens?: ProviderConfig;
}

export interface IdentitySourceConfig {
    type: string;
    org?: string;
    teamRoleMapping?: Record<string, string>;
    defaultRole?: string;
}

export interface IdentityConfig {
    sources: IdentitySourceConfig[];
}

// ── Model Definitions ──

export type ModelCapability = "fast" | "balanced" | "advanced";

export interface ModelDef {
    /** LLM provider type (e.g. "vertex-ai", "bedrock", "openai") */
    provider: string;
    /** Model ID as expected by the provider (e.g. "gemini-2.0-flash", "claude-sonnet-4") */
    modelId: string;
    /** Capability tier: fast (cheap/quick), balanced (general), advanced (complex reasoning) */
    capability: ModelCapability;
    /** Cost per 1k input tokens in USD (for budget tracking) */
    inputCostPer1kTokens: number;
    /** Cost per 1k output tokens in USD */
    outputCostPer1kTokens: number;
    /** Max output tokens supported */
    maxOutputTokens?: number;
}

export interface RoleDef {
    actions: string[];
    useCases: string[];
    persona: string;
    capabilities?: string;
    /** Allowed model names for this role (keys from spec.models). If omitted, all models are available. */
    models?: string[];
    maxTurns: number;
    maxBudgetUsd: number;
}

export interface UserEntry {
    externalId: string;
    source: string;
    name: string;
    role: string;
    packs?: string[];
}

export interface ResourceEntry {
    type: string;
    name: string;
    description: string;
}

export interface RepoEntry {
    name: string;
    description: string;
}

export interface EnvironmentConfig {
    name: string;
    cloud: string;
    account: string;
    region: string;
    env: string;
    resources: ResourceEntry[];
    repos: RepoEntry[];
}

export interface ProtocolMcpConfig {
    version: string;
    transport: string;
    futureTransport?: string;
    auth: string;
    futureAuth?: string;
}

export interface ProtocolA2aConfig {
    enabled: boolean;
    agentCard: boolean;
    version?: string;
}

export interface ProtocolsConfig {
    mcp?: ProtocolMcpConfig;
    a2a?: ProtocolA2aConfig;
}

export interface PlatformConfig {
    apiVersion: string;
    kind: string;
    metadata: { name: string };
    spec: {
        providers: ProviderConfigs;
        identity: IdentityConfig;
        roles: Record<string, RoleDef>;
        users: UserEntry[];
        environment: EnvironmentConfig;
        protocols?: ProtocolsConfig;
        authProviders?: Record<string, AuthProviderConfig>;
        /** Available models with cost and capability metadata. Keys are logical names used in role.models. */
        models?: Record<string, ModelDef>;
    };
}
