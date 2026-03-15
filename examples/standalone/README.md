# AgentRun - Standalone Server Deployment

This example runs AgentRun as a single Fastify server that handles both Slack events
and MCP JSON-RPC on the same process. Ideal for small teams, development, and
environments where Lambda/Cloud Functions are not available.

## Architecture

```
Slack ──> Fastify ──> /events ──> In-process queue ──> AgentRun orchestrator
                  └──> /mcp    ──> MCP JSON-RPC server
```

All processing happens in-process using an async queue (no SQS/Pub/Sub required).
For production use with high concurrency, consider the AWS Lambda or Docker examples.

## Prerequisites

- Node.js >= 20
- AWS credentials configured (for Bedrock LLM, DynamoDB sessions, S3 manifests)
- A Slack app with Events API and Interactivity enabled
- ngrok or similar tunnel for local development

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with the required variables:

```bash
# Slack app credentials
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# AgentRun platform config (S3 path or local file)
AGENTRUN_PLATFORM_CONFIG=s3://your-bucket/config.yaml

# AWS credentials (for Bedrock, DynamoDB, S3)
AWS_REGION=us-east-1
```

3. Start the server:

```bash
npm run dev
```

4. For local development, expose your server with ngrok:

```bash
ngrok http 3000
```

5. Configure Slack app:
   - Events URL: `https://<ngrok-url>/events`
   - Interactivity URL: `https://<ngrok-url>/events`

6. Configure Claude Code CLI:

```json
{
  "mcpServers": {
    "agentrun": {
      "type": "url",
      "url": "http://localhost:3000/mcp?scope=aws",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Project Structure

```
src/
  index.ts              # Fastify server with /events and /mcp routes
  setup.ts              # Provider registration
package.json
tsconfig.json
```
