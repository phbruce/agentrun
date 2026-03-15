# AgentRun

Multi-channel, manifest-driven, RBAC-gated AI Agent Runtime.

AgentRun is a self-hosted runtime that turns declarative YAML manifests into a fully operational AI agent — with tool calling, role-based access, session memory, and multi-channel delivery. Think of it as *containerd for AI agents*: you define what the agent can do, AgentRun handles the rest.

## Key Features

- **Manifest-driven** — Define tools, workflows, use-cases, skills, and knowledge bases as Kubernetes-style YAML
- **Multi-channel** — Same agent brain serves Slack, MCP (Model Context Protocol), and future channels
- **RBAC-gated** — Identity resolution, role mapping, and per-role use-case access with budget controls
- **Dual execution** — Skills run as `direct` (deterministic, fast) or `agent` (LLM reasoning loop)
- **Pack system** — Extension bundles loaded from any ManifestStore (S3, GCS, local filesystem), grouping tools + workflows + use-cases + skills
- **Session memory** — Per-thread conversation persistence with configurable TTL
- **RAG** — Built-in vector search over ingested documents (pgvector)

### Cloud-agnostic by design

Every infrastructure concern in AgentRun is behind a TypeScript interface defined in `@agentrun-ai/core`. The core package has **zero cloud dependencies** — all cloud-specific behavior is injected at startup via `PlatformRegistry`.

`@agentrun-ai/aws` is the reference implementation. `@agentrun-ai/gcp` provides Google Cloud providers. To run on another cloud, implement the same interfaces and register your providers:

```typescript
import { setProviderRegistrar, bootstrapPlatform } from "@agentrun-ai/core";
import { registerGcpProviders } from "@agentrun-ai/gcp";

// Use the GCP implementation (Vertex AI, Firestore, Cloud Storage, Pub/Sub, Secret Manager)
setProviderRegistrar(registerGcpProviders);
await bootstrapPlatform();
```

## Architecture

```
Channel Input → Identity Resolution → RBAC Gating → Routing
  → Execution (direct tool calls OR agentic LLM loop)
  → Session Persistence → Channel Delivery → Usage Tracking
```

### Provider Interfaces

Every infrastructure concern is a TypeScript interface in `@agentrun-ai/core`. The `@agentrun-ai/aws` package provides the reference implementation; alternatives can be built by implementing the same interfaces.

| Interface | Purpose | AWS impl (`@agentrun-ai/aws`) | GCP impl (`@agentrun-ai/gcp`) |
|-----------|---------|-------------------------------|-------------------------------|
| `LlmProvider` | LLM completions and summarization | Bedrock (`BedrockLlmProvider`) | Vertex AI (`VertexAiLlmProvider`) |
| `CredentialProvider` | Per-role scoped credentials | STS (`StsCredentialProvider`) | GCP IAM (`GcpCredentialProvider`) |
| `SessionStore` | Conversation history persistence | DynamoDB (`DynamoSessionStore`) | Firestore (`FirestoreSessionStore`) |
| `UsageStore` | Token and invocation tracking | DynamoDB (`DynamoUsageStore`) | Firestore (`FirestoreUsageStore`) |
| `ManifestStore` | Pack manifest storage and discovery | S3 (`S3ManifestStore`) | Cloud Storage (`GcsManifestStore`) |
| `QueueProvider` | Async message dispatch | SQS (`SqsQueueProvider`) | Pub/Sub (`PubSubQueueProvider`) |
| `BootstrapSecretProvider` | Secret retrieval at startup | Secrets Manager (`SmSecretProvider`) | Secret Manager (`GcpSecretProvider`) |
| `EmbeddingProvider` | Text embeddings for RAG | Bedrock Titan (`BedrockEmbeddingProvider`) | Vertex AI (`VertexEmbeddingProvider`) |
| `VectorStore` | Vector similarity search | pgvector (`PgVectorStore`) | pgvector (`PgVectorStore`) |
| `KnowledgeBaseProvider` | Managed RAG retrieval | Bedrock KB (`BedrockKbProvider`) | Vertex AI Search (`VertexSearchProvider`) |

## Packages

| Package | Description |
|---------|-------------|
| [`@agentrun-ai/core`](packages/core) | Orchestrator, agent runner, catalog, RBAC, platform registry, RAG |
| [`@agentrun-ai/aws`](packages/aws) | Bedrock LLM/embeddings, DynamoDB, S3, SQS, STS, Secrets Manager |
| [`@agentrun-ai/channel-slack`](packages/channel-slack) | Slack adapter, Block Kit formatting, identity resolution |
| [`@agentrun-ai/channel-gchat`](packages/channel-gchat) | Google Chat adapter, Cards V2 formatting, Workspace Add-on support |
| [`@agentrun-ai/channel-mcp`](packages/channel-mcp) | MCP JSON-RPC server for Claude Code and other MCP clients |
| [`@agentrun-ai/tools-aws`](packages/tools-aws) | AWS infrastructure tools (EKS, RDS, Lambda, CloudWatch, SQS) |
| [`@agentrun-ai/tools-github`](packages/tools-github) | GitHub tools (PRs, commits, reviews) |
| [`@agentrun-ai/tools-jira`](packages/tools-jira) | Jira tools (issues, comments, transitions) |
| [`@agentrun-ai/gcp`](packages/gcp) | GCP providers: Vertex AI, Firestore, Cloud Storage, Pub/Sub, Secret Manager |
| [`@agentrun-ai/cli`](packages/cli) | CLI: validate manifests, sync packs, ingest docs for RAG |

### Dependency graph

```
@agentrun-ai/core              (zero external deps — pure TypeScript)
    ↑
@agentrun-ai/aws               @aws-sdk/*, @agentrun-ai/core
@agentrun-ai/gcp               @google-cloud/*, @agentrun-ai/core
@agentrun-ai/channel-slack     @slack/web-api, @agentrun-ai/core
@agentrun-ai/channel-gchat     @agentrun-ai/core
@agentrun-ai/channel-mcp       @agentrun-ai/core
@agentrun-ai/tools-aws         @aws-sdk/*, @agentrun-ai/core
@agentrun-ai/tools-github      @octokit/rest, @agentrun-ai/core
@agentrun-ai/tools-jira        @agentrun-ai/core
@agentrun-ai/cli               @agentrun-ai/core, commander
```

## Quick Start

### Option A: AWS providers

```bash
npm install @agentrun-ai/core @agentrun-ai/aws @agentrun-ai/channel-slack
```

```typescript
import { setProviderRegistrar, bootstrapPlatform, processRequest } from "@agentrun-ai/core";
import { registerAwsProviders } from "@agentrun-ai/aws";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";

// Use the AWS reference implementation (Bedrock, DynamoDB, S3, SQS, STS)
setProviderRegistrar(registerAwsProviders);
await bootstrapPlatform();

const adapter = new SlackChannelAdapter();
await processRequest(adapter, {
    userId: "U12345",
    channelId: "C12345",
    text: "show me the cluster status",
    threadTs: "1234567890.123456",
});
```

### Option B: GCP providers

```bash
npm install @agentrun-ai/core @agentrun-ai/gcp @agentrun-ai/channel-slack
```

```typescript
import { setProviderRegistrar, bootstrapPlatform, processRequest } from "@agentrun-ai/core";
import { registerGcpProviders } from "@agentrun-ai/gcp";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";

// Use the GCP implementation (Vertex AI, Firestore, Cloud Storage, Pub/Sub, Secret Manager)
setProviderRegistrar(registerGcpProviders);
await bootstrapPlatform();

const adapter = new SlackChannelAdapter();
await processRequest(adapter, {
    userId: "U12345",
    channelId: "C12345",
    text: "show me the cluster status",
    threadTs: "1234567890.123456",
});
```

## Deployment Examples

| Example | Description |
|---------|-------------|
| [`aws-lambda`](examples/aws-lambda) | AWS serverless: API Gateway + Lambda + SQS + DynamoDB |
| [`gcp-cloud-functions`](examples/gcp-cloud-functions) | Google Cloud Functions + Pub/Sub |
| [`gchat-standalone`](examples/gchat-standalone) | Google Chat bot via Fastify + HTTP endpoint |
| [`slack-standalone`](examples/slack-standalone) | Single Fastify server, no external dependencies |
| [`docker`](examples/docker) | Docker Compose with PostgreSQL (pgvector) + Redis |

## Documentation

- [AgentRun Book](docs/book/agentrun-book.md) — Complete platform reference (governance, security, architecture)
- [Contributing](CONTRIBUTING.md) — Development setup and contribution guide
- [Security](SECURITY.md) — Vulnerability disclosure policy
- [CLA](CLA.md) — Contributor License Agreement

## Manifest Example

```yaml
# tools/list-open-prs.yaml
apiVersion: agentrun/v1
kind: Tool
metadata:
  name: list-open-prs
spec:
  mcpTool: list_open_prs
  description: List open pull requests for a repository
  category: ci-cd
  readOnly: true
  parameters:
    repo:
      type: string
      description: Repository name (owner/repo)
      required: true
```

```yaml
# use-cases/infra-health.yaml
apiVersion: agentrun/v1
kind: UseCase
metadata:
  name: infra-health
spec:
  label: Infrastructure Health
  description: Check the health of all infrastructure components
  workflows:
    - health-check
  icon: heart_pulse
```

## License

[GNU Affero General Public License v3.0](LICENSE) — See [NOTICE](NOTICE) for copyright.

AgentRun is free software: you can redistribute it and/or modify it under the terms of the AGPLv3. If you run a modified version of AgentRun as a network service, you must make the source code available to users of that service (AGPLv3 Section 13).

**Extensions via Packs** (YAML manifests) are configuration, not derivative works — no copyleft trigger.
