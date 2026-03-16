# AgentRun - Docker Deployment

This example runs AgentRun as a containerized Fastify server with Docker Compose,
including PostgreSQL (for sessions/vector store) and Redis (for caching/dedup).

Ideal for self-hosted deployments, on-prem environments, and local development.

## Architecture

```
                    ┌──────────────────────────┐
Slack ──> nginx ──> │  AgentRun (Fastify)       │
                    │  /events  (Slack webhook) │ ──> LLM Provider
                    │  /mcp     (MCP JSON-RPC)  │    (Bedrock, Vertex AI,
                    │  /health  (health check)  │     OpenAI, Ollama, etc.)
                    └──────────┬───────────────┘
                               │
                    ┌──────────┴───────────────┐
                    │  PostgreSQL 16            │
                    │  - Sessions               │
                    │  - pgvector (RAG)         │
                    ├──────────────────────────┤
                    │  Redis 7                  │
                    │  - Event dedup cache      │
                    └──────────────────────────┘
```

> **Cloud provider note**: The default `setup.ts` uses `@agentrun-ai/aws` (Bedrock, STS, Secrets Manager, S3, SQS, DynamoDB). To use GCP instead, replace `registerAwsProviders` with `registerGcpProviders` from `@agentrun-ai/gcp` (Vertex AI, GCP IAM, Secret Manager, Cloud Storage, Pub/Sub, Firestore). See "Swapping Providers" below. PostgreSQL and Redis run locally in Docker regardless of cloud provider.

## Prerequisites

- Docker and Docker Compose v2
- LLM provider credentials (AWS credentials for Bedrock by default, or credentials for your chosen provider)
- A Slack app with Events API and Interactivity enabled

## Quick Start

1. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your values
```

2. Start all services:

```bash
docker compose up -d
```

3. Check logs:

```bash
docker compose logs -f agentrun
```

4. Verify the server is running:

```bash
curl http://localhost:3000/health
```

5. For local development with Slack, expose the server:

```bash
# Using ngrok
ngrok http 3000

# Then set your Slack app's Events URL to:
# https://<ngrok-url>/events
```

## Development

For hot-reload during development:

```bash
docker compose -f docker-compose.yml up -d postgres redis
npm install
npm run dev
```

This starts only PostgreSQL and Redis in Docker, running the app locally with tsx.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `AWS_REGION` | If using AWS | AWS region for Bedrock |
| `AWS_ACCESS_KEY_ID` | If using AWS | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | If using AWS | AWS secret key |
| `AGENTRUN_PACKS` | No | Comma-separated pack names (default: "default") |
| `SLACK_BOT_TOKEN` | Yes | Slack bot OAuth token |
| `DATABASE_URL` | No | PostgreSQL URL (default: from docker-compose) |
| `REDIS_URL` | No | Redis URL (default: from docker-compose) |

### Pack Manifests

Mount your pack manifests directory into the container:

```yaml
# docker-compose.yml
services:
  agentrun:
    volumes:
      - ./manifests:/app/manifests:ro
```

## Production Deployment

For production, consider:

1. **Use a managed database** (RDS, Cloud SQL) instead of the Docker PostgreSQL
2. **Use a managed Redis** (ElastiCache, Memorystore) instead of the Docker Redis
3. **Enable TLS** via a reverse proxy (nginx, Caddy, Traefik)
4. **Set resource limits** in docker-compose.yml
5. **Use Docker secrets** instead of environment variables for sensitive values
6. **Run multiple replicas** behind a load balancer

## Swapping Providers

The Docker example uses `@agentrun-ai/aws` by default, but AgentRun's core is cloud-agnostic. Two provider packages are available out of the box:

**To switch to GCP:**

1. Install the GCP package: `npm install @agentrun-ai/gcp`
2. Edit `src/setup.ts`:
   ```typescript
   import { registerGcpProviders } from "@agentrun-ai/gcp";
   setProviderRegistrar(registerGcpProviders);
   ```
3. Replace `AWS_*` environment variables in `.env` with GCP equivalents (`GCP_PROJECT_ID`, `GCP_REGION`, etc.)

**To use a different cloud or self-hosted stack:**

1. Implement the required interfaces from `@agentrun-ai/core` (`LlmProvider`, `SessionStore`, `ManifestStore`, etc.)
2. For a fully self-contained setup, use PostgreSQL for sessions/usage (implement `SessionStore` and `UsageStore` against the local PostgreSQL) and the local filesystem for manifests (implement `ManifestStore` reading from a mounted volume)
3. Update the environment variables in `.env` to match your provider requirements

See the [Provider Interfaces table](../../README.md#provider-interfaces) in the main README for the full list of interfaces and implementations.

## Project Structure

```
src/
  index.ts              # Fastify server
  setup.ts              # Provider registration
Dockerfile              # Multi-stage build
docker-compose.yml      # Full stack (app + postgres + redis)
.env.example            # Environment variable template
package.json
tsconfig.json
```
