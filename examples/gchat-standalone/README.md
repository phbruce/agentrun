# AgentRun - Google Chat Standalone Server

This example runs AgentRun as a single Fastify server that handles Google Chat
events via HTTP POST. Ideal for small teams, development, and environments where
Lambda/Cloud Functions are not available.

## Architecture

```
Google Chat ──> Fastify ──> /gchat ──> In-process queue ──> AgentRun orchestrator
```

All processing happens in-process using an async queue (no SQS/Pub/Sub required).
Google Chat sends HTTP POST requests to your `/gchat` endpoint for every event
(messages, bot added/removed). The server responds immediately and processes the
query in the background, delivering results via the Google Chat API.

## Prerequisites

- Node.js >= 18
- AWS credentials configured (for Bedrock LLM, DynamoDB sessions, S3 manifests)
- A Google Cloud project with the Google Chat API enabled
- A Google Chat app configured as an HTTP endpoint
- ngrok or similar tunnel for local development

## Setup

1. **Create a Google Chat app** in the
   [Google Cloud Console](https://console.cloud.google.com/apis/api/chat.googleapis.com):
   - Enable the Google Chat API
   - Go to **Configuration** and set the app name and avatar
   - Under **Connection settings**, select **HTTP endpoint URL**
   - Set the URL to your server's `/gchat` endpoint (e.g., `https://<ngrok-url>/gchat`)
   - Under **Visibility**, add the users/groups that should see the bot

2. **Create a service account** (or use Workload Identity Federation):
   - Create a service account with the `Chat Bots` role
   - Download the JSON key file
   - The adapter uses this to send messages back to Google Chat

3. **Install dependencies:**

```bash
npm install
```

4. **Configure environment variables:**

```bash
# Google Chat service account credentials (JSON key file path or contents)
export GCHAT_SERVICE_ACCOUNT_KEY=/path/to/service-account.json

# AgentRun platform config (S3 path or local file)
export AGENTRUN_PLATFORM_CONFIG=s3://your-bucket/config.yaml

# AgentRun packs to load (comma-separated)
export AGENTRUN_PACKS=default

# AWS credentials (for Bedrock, DynamoDB, S3)
export AWS_REGION=us-east-1
export AWS_PROFILE=your-profile  # or use IAM role / env vars

# Server config (optional)
export PORT=3000
export HOST=0.0.0.0
```

5. **Start the server:**

```bash
npm run dev
```

6. **For local development**, expose your server with ngrok:

```bash
ngrok http 3000
```

Then update the Google Chat app's HTTP endpoint URL to `https://<ngrok-url>/gchat`.

## Testing

1. Open Google Chat and find your bot in the sidebar (or start a DM with it)
2. Send a message like "health check" or "list lambdas"
3. The bot will respond with "Processando..." and then update the message with the result

## Project Structure

```
src/
  index.ts              # Fastify server with /gchat endpoint
  setup.ts              # Provider and tool factory registration
package.json
tsconfig.json
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GCHAT_SERVICE_ACCOUNT_KEY` | Yes | Path to Google Chat service account JSON key |
| `AGENTRUN_PLATFORM_CONFIG` | Yes | Platform config location (S3 URI or local path) |
| `AGENTRUN_PACKS` | No | Comma-separated pack names (default: `default`) |
| `AWS_REGION` | Yes | AWS region for Bedrock, DynamoDB, S3 |
| `PORT` | No | Server port (default: `3000`) |
| `HOST` | No | Server bind address (default: `0.0.0.0`) |
