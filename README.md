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

`@agentrun-ai/aws` and `@agentrun-ai/gcp` are the two production-ready implementations. To run on another cloud, implement the same interfaces and register your providers:

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

Every infrastructure concern is a TypeScript interface in `@agentrun-ai/core`. The `@agentrun-ai/aws` and `@agentrun-ai/gcp` packages provide production-ready implementations; additional providers can be built by implementing the same interfaces.

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

Pick the cloud provider package that matches your infrastructure, then wire it up:

```bash
# AWS (Bedrock, DynamoDB, S3, SQS, STS, Secrets Manager)
npm install @agentrun-ai/core @agentrun-ai/aws @agentrun-ai/channel-slack

# GCP (Vertex AI, Firestore, Cloud Storage, Pub/Sub, Secret Manager)
npm install @agentrun-ai/core @agentrun-ai/gcp @agentrun-ai/channel-slack
```

```typescript
import { setProviderRegistrar, bootstrapPlatform, processRequest } from "@agentrun-ai/core";
import { SlackChannelAdapter } from "@agentrun-ai/channel-slack";

// Choose ONE provider package:
import { registerAwsProviders } from "@agentrun-ai/aws";
// import { registerGcpProviders } from "@agentrun-ai/gcp";

setProviderRegistrar(registerAwsProviders);   // or registerGcpProviders
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
| [`gcp-cloud-functions`](examples/gcp-cloud-functions) | GCP serverless: Cloud Functions + Pub/Sub + Firestore |
| [`gchat-standalone`](examples/gchat-standalone) | Google Chat bot via Fastify + HTTP endpoint |
| [`slack-standalone`](examples/slack-standalone) | Single Fastify server, no external dependencies |
| [`docker`](examples/docker) | Docker Compose with PostgreSQL (pgvector) + Redis |

## Documentation

- [AgentRun Book](docs/book/agentrun-book.md) — Complete platform reference (governance, security, architecture)
- [Contributing](CONTRIBUTING.md) — Development setup and contribution guide
- [Security](SECURITY.md) — Vulnerability disclosure policy
- [CLA](CLA.md) — Contributor License Agreement

## Manifest Examples

AgentRun uses 6 manifest kinds. All follow the `apiVersion: agentrun/v1` pattern:

### Tool — atomic capability

```yaml
# tools/list-open-prs.yaml
apiVersion: agentrun/v1
kind: Tool
metadata:
  name: list-open-prs
spec:
  type: mcp-server           # mcp-server | aws-sdk | http | lambda
  mcpTool: list_open_prs     # maps to MCP tool registry name
  description: List open pull requests
  category: development
  readOnly: true
```

### Workflow — composes tools

```yaml
# workflows/review-pull-requests.yaml
apiVersion: agentrun/v1
kind: Workflow
metadata:
  name: review-pull-requests
spec:
  description: Review open PRs across repositories
  tools:
    - list-open-prs
    - get-pr-details
    - recent-commits
```

### Workflow with steps — deterministic pipeline

```yaml
# workflows/check-billing.yaml
apiVersion: agentrun/v1
kind: Workflow
metadata:
  name: check-billing
spec:
  description: Get AWS cost breakdown for the current month
  tools:
    - check-billing
  steps:
    - tool: check-billing
      action: GetCostAndUsage
      input:
        TimePeriod:
          Start: "{{ startDate }}"
          End: "{{ endDate }}"
        Granularity: MONTHLY
        Metrics: ["UnblendedCost"]
      outputTransform: "ResultsByTime[0].Total.UnblendedCost"
      timeoutMs: 10000
```

### UseCase — maps user intent to workflows

```yaml
# use-cases/code-review.yaml
apiVersion: agentrun/v1
kind: UseCase
metadata:
  name: code-review
spec:
  description: Review PRs and recent commits
  keywords: [pr, pull request, review, merge, commit, deploy]
  workflows:
    - review-pull-requests
  scope: github              # MCP server scope filtering
  template: |
    List open PRs with author, title, status, and highlights.
```

### Skill — slash command with prompt + tools

```yaml
# skills/health-check.yaml
apiVersion: agentrun/v1
kind: Skill
metadata:
  name: health-check
spec:
  command: /health-check
  description: Full infrastructure health check
  mode: direct               # direct (fast) | agent (LLM reasoning)
  tools:
    - describe-eks-cluster
    - describe-rds
    - list-lambdas
    - list-sqs-queues
  prompt: |
    Check all infrastructure components and report status.
    Use OK/Warning/Critical for each service.
  allowedRoles: [developer, operator, admin]
  maxBudgetUsd: 0.15
```

### Eval — test cases for skill routing

```yaml
# evals/health-check.yaml
apiVersion: agentrun/v1
kind: Eval
metadata:
  name: health-check
spec:
  target:
    kind: Skill
    name: health-check
  triggerCases:
    - query: "how is the infrastructure?"
      shouldTrigger: true
    - query: "find the checkout lambda"
      shouldTrigger: false
  executionCases:
    - id: full-health
      prompt: "check infrastructure health"
      expectations:
        - type: tool_called
          value: describe_eks_cluster
        - type: tool_called
          value: describe_rds
  config:
    passThreshold: 0.8
    maxBudgetPerCaseUsd: 0.15
```

## License

[GNU Affero General Public License v3.0](LICENSE) — See [NOTICE](NOTICE) for copyright.

AgentRun is free software: you can redistribute it and/or modify it under the terms of the AGPLv3. If you run a modified version of AgentRun as a network service, you must make the source code available to users of that service (AGPLv3 Section 13).

**Extensions via Packs** (YAML manifests) are configuration, not derivative works — no copyleft trigger.
