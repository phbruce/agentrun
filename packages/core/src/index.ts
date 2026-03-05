// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-oss/core — Multi-channel, manifest-driven, RBAC-gated AI Agent Runtime

// Logger
export { logger } from "./logger.js";

// Errors
export { AgentRunError, NotFoundError, BadRequestError, ForbiddenError, UnauthorizedError } from "./errors.js";

// Platform types
export type {
    PlatformConfig,
    ProviderConfig,
    ProviderConfigs,
    IdentityConfig,
    IdentitySourceConfig,
    RoleDef,
    UserEntry,
    ResourceEntry,
    RepoEntry,
    EnvironmentConfig,
} from "./platform/types.js";

// Provider interfaces
export type {
    LlmProvider,
    LlmResponse,
    ToolResultInput,
    CredentialProvider,
    SessionStore,
    SessionMessage,
    UsageStore,
    MonthlyUsage,
    ManifestStore,
    QueueProvider,
    BootstrapSecretProvider,
    EmbeddingProvider,
    EmbeddingResult,
    VectorStore,
    VectorChunk,
    DocumentChunk,
    DocumentIngester,
    KnowledgeBaseProvider,
    KnowledgeBaseSearchResult,
} from "./platform/types.js";

// Platform registry
export { PlatformRegistry } from "./platform/registry.js";

// Platform config
export { loadPlatformConfig, buildDefaultConfig } from "./platform/config.js";

// Channel types
export type {
    ChannelContext,
    ChannelAdapter,
} from "./channels/types.js";

// Agent types
export type { AgentResult } from "./agent/agentRunner.js";

// Catalog types
export type {
    ToolType,
    ToolDef,
    WorkflowDef,
    UseCaseDef,
    SkillDef,
    KnowledgeBaseDef,
    ManifestCatalog,
} from "./catalog/types.js";

// Identity types
export type {
    IdentityProvider,
    ResolvedIdentity,
} from "./identity/types.js";

// RBAC types
export type { Role, IdentitySource } from "./rbac/types.js";

// RBAC functions
export { getRoleForUser, getDisplayName } from "./rbac/permissions.js";
export { getRoleConfig } from "./rbac/permissions.js";

// Catalog functions
export { getUseCasesForRole, getWorkflowsForUseCase, getSkillsForRole, setCatalog } from "./catalog/catalog.js";

// Usage
export { getMonthlyUsage } from "./usage/tracker.js";

// Classifier
export { classifyQuery } from "./classifier.js";
export type { ResponseCategory } from "./classifier.js";

// Catalog pack schemas (for CLI validation)
export {
    PackManifestSchema,
    RemoteToolSchema,
    RemoteWorkflowSchema,
    RemoteUseCaseSchema,
    RemoteSkillSchema,
    RemoteKnowledgeBaseSchema,
    UserSkillSchema,
} from "./catalog/packTypes.js";

export type { PackDef } from "./catalog/packTypes.js";

// RAG
export { MarkdownIngester } from "./rag/markdownIngester.js";

// Secret types
export type { ResolvedSecrets } from "./secret/types.js";

// MCP registry
export type { ToolHandler } from "./mcp/registry.js";
export { registerToolFactory, getToolRegistry, registerPackToolFactory, getPackToolFactories } from "./mcp/registry.js";

// MCP server factory
export { setMcpServerFactory, createMcpServer } from "./mcp/serverFactory.js";
export type { McpServerFactory } from "./mcp/serverFactory.js";

// Catalog sub-types needed by declarative tools
export type { InputSchemaDef, WorkflowStep } from "./catalog/types.js";

// Auth
export { getInstallationToken } from "./auth/githubApp.js";

// Bootstrap & platform lifecycle
export { bootstrapPlatform, ensurePlatform, setProviderRegistrar } from "./platform/bootstrap.js";
export type { ProviderRegistrar } from "./platform/bootstrap.js";

// Models
export { getModels } from "./platform/models.js";

// Orchestrator
export { processRequest } from "./orchestrator.js";

// Identity providers
export { GitHubTokenProvider } from "./identity/githubTokenProvider.js";
export { StaticIdentityProvider } from "./identity/staticProvider.js";

// Catalog pack loader
export { getPackDefs, loadCatalogForPacks } from "./catalog/packLoader.js";
export { getMcpToolNamesForRoleWithPacks, getMcpToolNamesForScope } from "./catalog/catalog.js";

// Secret resolver
export { createSecretResolver } from "./secret/index.js";

// Usage tracking
export { trackUsage } from "./usage/tracker.js";

// Protocols
export { buildAgentCard } from "./protocols/agentCard.js";

// MCP client factory
export { createClientsForIdentity, setClientFactory } from "./mcp/clientFactory.js";
export type { AwsClients } from "./mcp/clientFactory.js";

// RBAC
export { checkPermission } from "./rbac/rbac.js";
