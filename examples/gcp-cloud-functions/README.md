# AgentRun - GCP Cloud Functions Deployment

This example deploys AgentRun on Google Cloud Functions with Pub/Sub for async processing.

> **Note**: There is no `@agentrun-oss/gcp` provider package yet. This example uses
> `@agentrun-oss/aws` for the provider implementations (Bedrock for LLM, DynamoDB for
> sessions, S3 for manifests). If you want to run fully on GCP, you can implement the
> provider interfaces from `@agentrun-oss/core` (see the "Custom Providers" section below).

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
- AWS credentials (for cross-cloud Bedrock access) or Vertex AI credentials
- Slack app with Events API and Interactivity enabled

## Custom Providers (GCP-native)

To avoid cross-cloud dependencies, implement these interfaces from `@agentrun-oss/core`:

```typescript
import type {
    LlmProvider,
    SessionStore,
    ManifestStore,
    QueueProvider,
    CredentialProvider,
    UsageStore,
} from "@agentrun-oss/core";

// Example: Vertex AI LLM provider
class VertexAiLlmProvider implements LlmProvider {
    async query(messages, tools, systemPrompt) { /* ... */ }
}

// Example: Firestore session store
class FirestoreSessionStore implements SessionStore {
    async get(sessionId) { /* ... */ }
    async put(sessionId, messages, ttl) { /* ... */ }
}

// Example: Cloud Storage manifest store
class GcsManifestStore implements ManifestStore {
    async listPacks() { /* ... */ }
    async getManifest(pack, path) { /* ... */ }
}
```

Then register them using `PlatformRegistry`:

```typescript
import { PlatformRegistry } from "@agentrun-oss/core";

const registry = PlatformRegistry.instance();
registry.register({
    llm: new VertexAiLlmProvider(),
    sessions: new FirestoreSessionStore(),
    manifests: new GcsManifestStore(),
    // ... other providers
});
```

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
  setup.ts              # Provider registration
  handlers/
    events.ts           # HTTP -> Slack events + interactions -> Pub/Sub
    process.ts          # Pub/Sub -> query processing
    mcp-server.ts       # HTTP -> MCP JSON-RPC
package.json
tsconfig.json
```
