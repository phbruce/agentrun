# @agentrun-ai/core

Core runtime for AgentRun: orchestrator, RBAC, agent runners, platform abstraction, and catalog system.

Zero cloud dependencies — all infrastructure concerns are pluggable interfaces. `@agentrun-ai/aws` and `@agentrun-ai/gcp` provide production-ready implementations.

## Installation

```bash
npm install @agentrun-ai/core
```

## Quick Start

```typescript
import { setProviderRegistrar, bootstrapPlatform, processRequest } from "@agentrun-ai/core";
import { registerGcpProviders } from "@agentrun-ai/gcp";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";

setProviderRegistrar(registerGcpProviders);
await bootstrapPlatform();

const adapter = new SlackChannelAdapter();
await processRequest(adapter, {
    userId: "U12345",
    channelId: "C12345",
    text: "show cluster status",
});
```

## Core Concepts

### Platform Registry

AgentRun's dependency injection system. Register provider implementations at startup:

```typescript
import { setProviderRegistrar, bootstrapPlatform } from "@agentrun-ai/core";

// AWS
import { registerAwsProviders } from "@agentrun-ai/aws";
setProviderRegistrar(registerAwsProviders);

// or GCP
import { registerGcpProviders } from "@agentrun-ai/gcp";
setProviderRegistrar(registerGcpProviders);

await bootstrapPlatform();
```

### Model Router (v0.4.0)

Automatically select optimal LLM models based on query complexity and role permissions:

```typescript
import { selectModel, classifyComplexity } from "@agentrun-ai/core";

// Complexity classification (zero-cost heuristics)
const complexity = classifyComplexity("show cluster status");
// → "simple"

// RBAC-gated model selection
const models = {
    fast: { provider: "vertex", modelId: "gemini-1.5-flash", capability: "fast", ... },
    pro: { provider: "vertex", modelId: "gemini-2.0-pro", capability: "advanced", ... },
};

const selection = selectModel("analyze performance bottlenecks", models, ["fast", "pro"]);
// → { name: "pro", model: {...}, reason: "complex query → advanced model (pro)" }
```

**Complexity Tiers:**
- `simple` → "list status", "show prs", facts lookups → fast models
- `moderate` → multi-step synthesis
- `complex` → architecture design, impact analysis → advanced models

### Generic Agent Runner (v0.4.0)

Model-agnostic function calling with any LLM provider (Gemini, GPT, Ollama, etc.):

```typescript
import { processGenericQuery } from "@agentrun-ai/core";
import { createOpenAICaller } from "@agentrun-ai/core";

const openaiCaller = createOpenAICaller({
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
    resolveToken: async (userId) => {
        // Return per-user token from your token store
        return await tokenStore.getToken(userId, "openai");
    },
});

const result = await processGenericQuery(
    "show cluster status",
    "U12345",
    "google",
    {
        callLlm: openaiCaller,
        executeTool: myToolExecutor,
        evaluatorConfig: {
            enabled: true,
            criteria: [
                { name: "factual_accuracy", weight: 0.4 },
                { name: "completeness", weight: 0.3 },
            ],
        },
    }
);
```

### OpenAI-Compatible Caller (v0.4.0)

Generic LLM caller for any OpenAI-compatible API:

```typescript
import { createOpenAICaller } from "@agentrun-ai/core";

const caller = createOpenAICaller({
    baseUrl: "https://your-gateway.example.com",
    defaultModel: "gemini-2.0-flash",
    resolveToken: async (userId) => tokenStore.getToken(userId, "gateway"),
    timeoutMs: 60000,
});

const response = await caller({
    systemPrompt: "You are a helpful assistant.",
    contents: [{ role: "user", parts: [{ text: "hello" }] }],
    tools: toolDeclarations,
    userId: "U12345",
});
```

Works with:
- OpenAI API
- Self-hosted gateways
- Local LLM servers (Ollama, vLLM)
- Any OpenAI-compatible endpoint

## Architecture

| Layer | Responsibility |
|-------|-----------------|
| **Catalog** | Tool/workflow/skill/KB registry and routing |
| **Identity** | User/role resolution from channel sources |
| **RBAC** | Role-based access filtering to tools and use-cases |
| **Execution** | `direct` (deterministic), `agent` (Claude SDK), `generic` (model-agnostic) |
| **Evaluation** | Optional response quality scoring pre-delivery |
| **Platform** | Pluggable provider interfaces (LLM, session, secrets, storage) |

## Provider Interfaces

Every infrastructure concern is a TypeScript interface:

| Interface | Purpose |
|-----------|---------|
| `LlmProvider` | LLM completions and summarization |
| `SessionStore` | Conversation history persistence |
| `UsageStore` | Token and invocation tracking |
| `ManifestStore` | Pack manifest storage |
| `QueueProvider` | Async message dispatch |
| `BootstrapSecretProvider` | Secret retrieval at startup |
| `EmbeddingProvider` | Text embeddings for RAG |
| `VectorStore` | Vector similarity search |
| `KnowledgeBaseProvider` | Managed RAG retrieval |

Implement these to support a new cloud provider.

## Configuration

Define tools, workflows, roles, and models in a manifest:

```yaml
spec:
  models:
    fast:
      provider: vertex-ai
      modelId: gemini-1.5-flash
      capability: fast
      inputCostPer1kTokens: 0.00075
      outputCostPer1kTokens: 0.003

    advanced:
      provider: vertex-ai
      modelId: gemini-2.0-pro
      capability: advanced
      inputCostPer1kTokens: 0.01
      outputCostPer1kTokens: 0.03

  roles:
    engineer:
      models: [fast, advanced]
    analyst:
      models: [fast]
```

## Exports

**Model Router:**
- `selectModel(query, models, allowedNames)` → `ModelSelection`
- `classifyComplexity(query)` → `QueryComplexity`
- `getModelsForRole(models, allowedNames)` → model list
- Types: `ModelSelection`, `QueryComplexity`, `ModelDef`, `ModelCapability`

**Generic Runner:**
- `processGenericQuery(query, userId, source, config)` → `AgentResult`
- `createOpenAICaller(config)` → `callLlm` function
- Types: `GenericAgentConfig`, `OpenAICallerConfig`

**Core:**
- `bootstrapPlatform()` — Initialize platform from config
- `setProviderRegistrar(fn)` — Register provider implementations
- `processRequest(adapter, event)` — Process channel event
- Types: `PlatformConfig`, `PlatformRegistry`

## See Also

- [`@agentrun-ai/gcp`](../gcp) — GCP provider (Vertex AI, Firestore, Cloud KMS)
- [`@agentrun-ai/aws`](../aws) — AWS provider (Bedrock, DynamoDB, S3)
- [`@agentrun-ai/channel-slack`](../channel-slack) — Slack adapter
- [AgentRun README](../../README.md) — Full documentation
