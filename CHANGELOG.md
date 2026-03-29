# Changelog

All notable changes to AgentRun will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-29

### Added

#### Model Router
- `selectModel()` - Query complexity classification + RBAC-gated model selection
- `classifyComplexity()` - Zero-cost query complexity heuristics (simple/moderate/complex)
- `getModelsForRole()` - Role-based model filtering and sorting by capability then cost
- `ModelSelection` and `QueryComplexity` types
- Cost optimization: picks cheapest model meeting query complexity requirement
- Integration with `GenericAgentConfig` for seamless agent execution

#### OpenAI-Compatible Caller
- `createOpenAICaller()` - Generic LLM caller for OpenAI-compatible API endpoints
- Works with OpenAI API, Ollama, self-hosted gateways, Vertex AI, Azure OpenAI
- Per-user token resolution callback pattern for multi-tenant access
- Automatic message format conversion (agentrun ↔ OpenAI)
- Tool calling support with function declaration conversion
- Token counting for cost tracking (inputTokens, outputTokens)
- Built-in timeout and error handling
- `OpenAICallerConfig` type for configuration

#### Firestore User Token Store with KMS Encryption
- `FirestoreUserTokenStore` - Secure per-user OAuth token storage in Firestore
- Cloud KMS envelope encryption for sensitive tokens (accessToken, refreshToken, idToken)
- Plaintext queryable metadata (expiresAt, tokenType, scopes) for TTL management
- Implements `UserTokenStore` interface for platform pluggability
- Optional encryption — works with or without KMS key
- Perfect for multi-tenant Slack bots and OAuth flows
- Firestore document structure: `{collectionName}/{userId}/providers/{providerName}`

#### Documentation
- `packages/core/README.md` - Model router, generic runner, quick start
- `packages/gcp/README.md` - GCP provider setup, KMS configuration, Cloud SQL pgvector
- `examples/model-router-demo` - Working example: complexity classification + RBAC selection
- `examples/openai-gateway-demo` - Working example: Ollama, OpenAI, self-hosted gateway
- Updated main README.md with v0.4.0 features and architecture diagrams

#### Testing
- Unit tests for modelRouter (complexity classification, RBAC filtering, cost optimization)
- Unit tests for openaiCaller (message conversion, error handling, token counting)
- Unit tests for firestoreUserTokens (encryption/decryption, CRUD operations)
- Jest configuration and test scripts (`npm test`, `npm run test:watch`, `npm run test:coverage`)

### Changed
- `AgentResult` now includes `modelUsed` field for audit and analytics
- `GenericAgentConfig` extended to support model selection strategy
- `PlatformConfig` schema extended for `ModelDef` declarations
- `PlatformRegistry` accepts model definitions at bootstrap
- Version bumps: `@agentrun-ai/core` 0.3.2 → 0.4.0, `@agentrun-ai/gcp` 0.3.2 → 0.4.0

### Deprecated
- Direct LLM selection without complexity classification (use `selectModel()` instead)

### Fixed
- JSON parse error handling in openaiCaller (wrapped in try-catch)
- Token store null/undefined consistency (standardized on undefined)
- Platform config model validation (spec.models now required)

### Security
- Zero hardcoded secrets, zero company identifiers
- KMS encryption verified for token storage
- RBAC enforcement pre-execution
- Input validation against injection vulnerabilities

### TODO
- [ ] Integration tests with real LLMs (Gemini, GPT, Ollama)
- [ ] Feature flag for Codeen gateway integration (pending repo access)
- [ ] `createCodeenCaller()` for Cosmos/Codeen compatibility
- [ ] Dependency vulnerability updates (fast-xml-parser@5.3.8+, @tootallnate/once@2.0.1+)
- [ ] Test coverage badges in README (CI/CD pipeline setup)
- [ ] Migration guide (0.3.2 → 0.4.0)

## [0.3.2] - 2026-03-24

### Added
- Generic agent runner with evaluator support
- GCS manifest storage provider
- Platform configuration schema with Zod validation
- Response evaluation with custom quality criteria

### Fixed
- GCP example deployment issues
- Debug logging removal for production readiness

## [0.3.1] - 2026-03-20

### Added
- Workspace dependency resolution in lock file
- Auto token refresh for agentrun core

### Fixed
- Workspace dependency management (workspace:* → ^0.3.0)

## [0.3.0] - 2026-03-15

### Added
- Initial release of agentrun orchestrator
- Multi-channel support (Slack, Google Chat, MCP)
- RBAC-gated tool execution
- Session persistence with Firestore
- GCP and AWS provider implementations
