# AgentRun - GCP Cloud Functions Deployment

This example deploys AgentRun on Google Cloud Functions with Pub/Sub for async processing.

> This example uses `@agentrun-ai/gcp` for all provider implementations (Vertex AI for LLM,
> Firestore for sessions, Cloud Storage for manifests, Pub/Sub for queues, Secret Manager for secrets).

## Architecture

```
Slack ──> Cloud Function (events) ──> Pub/Sub ──> Cloud Function (process) ──> Bedrock / Vertex AI
                                  └──> Cloud Function (mcp-server)
```

- **events**: HTTP-triggered function for Slack Events API + interactions
- **process**: Pub/Sub-triggered function for query processing
- **mcp-server**: HTTP-triggered MCP JSON-RPC server for Claude Code CLI

## Prerequisites

- Node.js >= 18
- Google Cloud SDK (`gcloud`)
- A GCP project with Cloud Functions and Pub/Sub enabled
- GCP credentials with Vertex AI, Firestore, Cloud Storage, Pub/Sub, and Secret Manager access
- Slack app with Events API and Interactivity enabled

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Pub/Sub topic:

```bash
gcloud pubsub topics create agentrun-process
gcloud pubsub subscriptions create agentrun-process-sub \
    --topic=agentrun-process \
    --ack-deadline=300
```

3. Set up secrets:

```bash
echo -n "xoxb-your-slack-token" | gcloud secrets create agentrun-slack-token --data-file=-
echo -n "ghp_your-github-token" | gcloud secrets create agentrun-github-token --data-file=-
echo -n "your-jira-api-token" | gcloud secrets create agentrun-jira-token --data-file=-
```

4. Deploy the functions:

```bash
# Events handler (Slack webhook receiver)
gcloud functions deploy agentrun-events \
    --gen2 \
    --runtime=nodejs18 \
    --trigger-http \
    --allow-unauthenticated \
    --entry-point=eventsHandler \
    --source=dist/events/ \
    --set-env-vars="PUBSUB_TOPIC=agentrun-process,GCP_PROJECT_ID=your-project"

# Process handler (Pub/Sub consumer)
gcloud functions deploy agentrun-process \
    --gen2 \
    --runtime=nodejs18 \
    --trigger-topic=agentrun-process \
    --entry-point=processHandler \
    --source=dist/process/ \
    --timeout=300 \
    --memory=512MB \
    --set-env-vars="AGENTRUN_PACKS=default"

# MCP server (Claude Code CLI endpoint)
gcloud functions deploy agentrun-mcp \
    --gen2 \
    --runtime=nodejs18 \
    --trigger-http \
    --allow-unauthenticated \
    --entry-point=mcpHandler \
    --source=dist/mcp-server/ \
    --timeout=30 \
    --memory=256MB
```

5. Configure Slack app:
   - Events URL: `https://<region>-<project>.cloudfunctions.net/agentrun-events`
   - Interactivity URL: same as Events URL

## Project Structure

```
src/
  setup.ts              # GCP provider registration
  handlers/
    events.ts           # HTTP -> Slack events + interactions -> Pub/Sub
    process.ts          # Pub/Sub -> query processing
    mcp-server.ts       # HTTP -> MCP JSON-RPC
package.json
tsconfig.json
```
