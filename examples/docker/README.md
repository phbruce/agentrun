# AgentRun - Docker Deployment

This example runs AgentRun as a containerized Fastify server with Docker Compose,
including PostgreSQL (for sessions/vector store) and Redis (for caching/dedup).

Ideal for self-hosted deployments, on-prem environments, and local development.

## Architecture

```
                    ┌──────────────────────────┐
Slack ──> nginx ──> │  AgentRun (Fastify)       │
                    │  /events  (Slack webhook) │ ──> Bedrock (AWS)
                    │  /mcp     (MCP JSON-RPC)  │
                    │  /health  (health check)  │
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

## Prerequisites

- Docker and Docker Compose v2
- AWS credentials (for Bedrock LLM access)
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
| `AWS_REGION` | Yes | AWS region for Bedrock |
| `AWS_ACCESS_KEY_ID` | Yes | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key |
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
