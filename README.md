# AgentRun

Multi-channel, manifest-driven, RBAC-gated AI Agent Runtime.

AgentRun is a self-hosted runtime that turns declarative YAML manifests into a fully operational AI agent — with tool calling, role-based access, session memory, and multi-channel delivery. Think of it as *containerd for AI agents*: you define what the agent can do, AgentRun handles the rest.

## Key Features

- **Manifest-driven** — Define tools, workflows, use-cases, skills, and knowledge bases as Kubernetes-style YAML
- **Multi-channel** — Same agent brain serves Slack, MCP (Model Context Protocol), and future channels
- **RBAC-gated** — Identity resolution, role mapping, and per-role use-case access with budget controls
- **Dual execution** — Skills run as `direct` (deterministic, fast) or `agent` (LLM reasoning loop)
- **Pack system** — Extension bundles loaded from S3, grouping tools + workflows + use-cases + skills
- **Session memory** — Per-thread conversation persistence with configurable TTL
- **RAG** — Built-in vector search over ingested documents (pgvector)

## Architecture

```
Channel Input → Identity Resolution → RBAC Gating → Routing
  → Execution (direct tool calls OR agentic LLM loop)
  → Session Persistence → Channel Delivery → Usage Tracking
```

## Packages

| Package | Description |
|---------|-------------|
| [`@agentrun-oss/core`](packages/core) | Orchestrator, agent runner, catalog, RBAC, platform registry, RAG |
| [`@agentrun-oss/aws`](packages/aws) | Bedrock LLM/embeddings, DynamoDB, S3, SQS, STS, Secrets Manager |
| [`@agentrun-oss/channel-slack`](packages/channel-slack) | Slack adapter, Block Kit formatting, identity resolution |
| [`@agentrun-oss/channel-mcp`](packages/channel-mcp) | MCP JSON-RPC server for Claude Code and other MCP clients |
| [`@agentrun-oss/tools-aws`](packages/tools-aws) | AWS infrastructure tools (EKS, RDS, Lambda, CloudWatch, SQS) |
| [`@agentrun-oss/tools-github`](packages/tools-github) | GitHub tools (PRs, commits, reviews) |
| [`@agentrun-oss/tools-jira`](packages/tools-jira) | Jira tools (issues, comments, transitions) |
| [`@agentrun-oss/cli`](packages/cli) | CLI: validate manifests, sync packs, ingest docs for RAG |

### Dependency graph

```
@agentrun-oss/core              (zero external deps — pure TypeScript)
    ↑
@agentrun-oss/aws               @aws-sdk/*, @agentrun-oss/core
@agentrun-oss/channel-slack     @slack/web-api, @agentrun-oss/core
@agentrun-oss/channel-mcp       @agentrun-oss/core
@agentrun-oss/tools-aws         @aws-sdk/*, @agentrun-oss/core
@agentrun-oss/tools-github      @octokit/rest, @agentrun-oss/core
@agentrun-oss/tools-jira        @agentrun-oss/core
@agentrun-oss/cli               @agentrun-oss/core, commander
```

## Quick Start

```bash
npm install @agentrun-oss/core @agentrun-oss/aws @agentrun-oss/channel-slack
```

```typescript
import { bootstrapPlatform, processRequest } from "@agentrun-oss/core";
import { registerAwsProviders } from "@agentrun-oss/aws";
import { SlackChannelAdapter } from "@agentrun-oss/channel-slack";

// Register AWS providers (Bedrock, DynamoDB, S3, etc.)
registerAwsProviders();

// Bootstrap platform from config
await bootstrapPlatform();

// Process a request
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
| [`aws-lambda`](examples/aws-lambda) | Production architecture: API Gateway + Lambda + SQS + DynamoDB |
| [`gcp-cloud-functions`](examples/gcp-cloud-functions) | Google Cloud Functions + Pub/Sub |
| [`standalone`](examples/standalone) | Single Fastify server, no external dependencies |
| [`docker`](examples/docker) | Docker Compose with PostgreSQL (pgvector) + Redis |

## Documentation

- [AgentRun Book](docs/book/agentrun-book.md) — Complete platform reference (governance, security, architecture)
- [Contributing](CONTRIBUTING.md) — Development setup and contribution guide
- [Security](SECURITY.md) — Vulnerability disclosure policy
- [CLA](CLA.md) — Contributor License Agreement

## Manifest Example

```yaml
# tools/describe-cluster.yaml
apiVersion: agentrun/v1
kind: Tool
metadata:
  name: describe-eks-cluster
spec:
  mcpTool: describe_eks_cluster
  description: Describe an EKS cluster
  category: infrastructure
  readOnly: true
  parameters:
    cluster_name:
      type: string
      description: EKS cluster name
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
