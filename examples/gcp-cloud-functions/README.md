# AgentRun - GCP Cloud Functions Deployment

This example deploys AgentRun on Google Cloud Functions with dual-channel support (Slack + Google Chat) and Pub/Sub for async processing.

> Uses `@agentrun-ai/gcp` for all provider implementations (Vertex AI for LLM,
> Firestore for sessions, Cloud Storage for manifests, Pub/Sub for queues, Secret Manager for secrets).

## Architecture

```
Slack ──────> Cloud Function (events)  ──┐
                                         ├──> Pub/Sub ──> Cloud Function (process) ──> Vertex AI
Google Chat ─> Cloud Function (gchat)  ──┘
                                         └──> Cloud Function (mcp-server)
```

| Function | Trigger | Purpose |
|----------|---------|---------|
| `agentrun-events` | HTTP | Slack Events API + interactions webhook |
| `agentrun-gchat` | HTTP | Google Chat Workspace Add-on webhook |
| `agentrun-process` | Pub/Sub | Agent query processing (dual-channel) |
| `agentrun-mcp` | HTTP | MCP JSON-RPC server for Claude Code CLI |

## Prerequisites

- Node.js >= 20
- Google Cloud SDK (`gcloud`)
- Terraform >= 1.5 (or OpenTofu) + Terragrunt
- A GCP project with the following APIs enabled:

```bash
gcloud services enable \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    pubsub.googleapis.com \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    aiplatform.googleapis.com \
    storage.googleapis.com \
    iam.googleapis.com
```

## Deployment

### 1. Provision infrastructure with Terraform

```bash
cd terraform

# Initialize and apply (Terragrunt generates provider + variables)
terragrunt init
terragrunt apply -var="project_id=YOUR_GCP_PROJECT_ID"
```

This creates all resources in a single apply:
- Service account (`agentrun-prd-runtime`)
- Cloud Storage buckets (manifests + function source)
- Pub/Sub topic (`agentrun-prd-process`)
- Firestore database
- Secret Manager secrets (3: slack-bot-token, github-token, gchat-service-account)
- Cloud Functions (4: events, gchat, process, mcp)
- IAM bindings (Pub/Sub, Firestore, Vertex AI, Secret Manager, Cloud Run)

### 2. Store secrets

```bash
# Slack bot token
echo -n "xoxb-your-slack-token" | \
    gcloud secrets versions add agentrun-prd-slack-bot-token --data-file=-

# GitHub token
echo -n "ghp_your-github-token" | \
    gcloud secrets versions add agentrun-prd-github-token --data-file=-

# Google Chat service account key (JSON)
gcloud secrets versions add agentrun-prd-gchat-service-account \
    --data-file=path/to/gchat-service-account.json
```

### 3. Build and deploy code

```bash
# From the example root directory
npm install
npm run build

# Deploy each function (replace placeholder source)
gcloud functions deploy agentrun-prd-events \
    --gen2 --runtime=nodejs20 --trigger-http \
    --allow-unauthenticated \
    --entry-point=eventsHandler \
    --source=dist/ \
    --region=us-central1

gcloud functions deploy agentrun-prd-gchat \
    --gen2 --runtime=nodejs20 --trigger-http \
    --allow-unauthenticated \
    --entry-point=gchatEventsHandler \
    --source=dist/ \
    --region=us-central1

gcloud functions deploy agentrun-prd-process \
    --gen2 --runtime=nodejs20 \
    --trigger-topic=agentrun-prd-process \
    --entry-point=processHandler \
    --source=dist/ \
    --timeout=300 --memory=512MB \
    --region=us-central1

gcloud functions deploy agentrun-prd-mcp \
    --gen2 --runtime=nodejs20 --trigger-http \
    --allow-unauthenticated \
    --entry-point=mcpHandler \
    --source=dist/ \
    --timeout=30 --memory=256MB \
    --region=us-central1
```

### 4. Configure Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Set **Event Subscriptions** Request URL to the `events_function_url` output:
   ```
   https://REGION-PROJECT_ID.cloudfunctions.net/agentrun-prd-events
   ```
3. Set **Interactivity & Shortcuts** Request URL to the same URL
4. Subscribe to bot events: `app_mention`, `message.im`

### 5. Configure Google Chat app

1. Go to [Google Cloud Console > APIs & Services > Google Chat API](https://console.cloud.google.com/apis/api/chat.googleapis.com)
2. On the **Configuration** tab:
   - App name: your bot name
   - App URL: the `gchat_function_url` output:
     ```
     https://REGION-PROJECT_ID.cloudfunctions.net/agentrun-prd-gchat
     ```
   - Enable **Spaces and group conversations**
   - Enable **1:1 messages**
3. Under **Connection settings**, select **HTTP endpoint URL**
4. Set **Authentication Audience** to the same URL

### 6. Configure Claude Code CLI (MCP)

Add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "agentrun": {
      "url": "https://REGION-PROJECT_ID.cloudfunctions.net/agentrun-prd-mcp",
      "headers": {
        "Authorization": "Bearer $(gh auth token)"
      }
    }
  }
}
```

## Project Structure

```
src/
  setup.ts                    # GCP provider registration
  handlers/
    events.ts                 # HTTP -> Slack events + interactions -> Pub/Sub
    gchat-events.ts           # HTTP -> Google Chat webhooks -> Pub/Sub
    process.ts                # Pub/Sub -> dual-channel query processing
    mcp-server.ts             # HTTP -> MCP JSON-RPC
terraform/
  terragrunt.hcl              # Root Terragrunt config (provider + variables)
  main.tf                     # All GCP resources (single file, no modules)
  outputs.tf                  # Function URLs + resource names
package.json
tsconfig.json
```

## Environment Variables

| Variable | Description | Set by |
|----------|-------------|--------|
| `GCP_PROJECT_ID` | GCP project ID | Terraform |
| `GCP_REGION` | GCP region | Terraform |
| `PUBSUB_TOPIC` | Pub/Sub topic name | Terraform |
| `AGENTRUN_PACKS` | Comma-separated pack names | Terraform |
| `AGENTRUN_SLACK_SECRET` | Secret Manager ID for Slack bot token | Terraform |
| `AGENTRUN_GITHUB_SECRET` | Secret Manager ID for GitHub token | Terraform |
| `AGENTRUN_GCHAT_SECRET` | Secret Manager ID for GChat service account key | Terraform |
| `AGENTRUN_SESSION_TABLE` | Firestore collection for sessions | Terraform |
| `AGENTRUN_MANIFESTS_BUCKET` | Cloud Storage bucket for manifests | Terraform |
