# AgentRun - AWS Lambda Deployment

This example deploys AgentRun on AWS Lambda with API Gateway, SQS, DynamoDB, and S3.
It mirrors the production architecture used at scale with 100+ Lambda functions.

## Architecture

```
Slack ──> API Gateway ──> events Lambda ──> SQS ──> process Lambda ──> Bedrock
                      └──> mcp-server Lambda (JSON-RPC for Claude Code CLI)
```

- **events**: Receives Slack Events API webhooks and interaction payloads. Validates, deduplicates (DynamoDB), and dispatches to SQS.
- **process**: Consumes SQS messages, runs the AgentRun orchestrator with tool execution, and responds via Slack.
- **mcp-server**: Stateless MCP JSON-RPC endpoint for Claude Code CLI integration. Authenticates via GitHub token.

## Prerequisites

- Node.js >= 20
- AWS CLI v2 configured with appropriate IAM permissions
- AWS SAM CLI (`brew install aws-sam-cli`)
- A Slack app with Events API and Interactivity enabled
- An S3 bucket for pack manifests (tool/workflow/skill YAML definitions)
- A DynamoDB table for sessions and another for event deduplication
- Secrets Manager secrets for Slack, GitHub, and Jira tokens

## AWS Resources Required

| Resource | Purpose |
|----------|---------|
| DynamoDB `agentrun-sessions` | Session store (conversation history) |
| DynamoDB `agentrun-dedup` | Event deduplication (TTL 5 min) |
| DynamoDB `agentrun-usage` | Usage tracking |
| S3 `agentrun-manifests` | Pack manifests (tools, workflows, skills) |
| SQS `agentrun-process` | Query processing queue |
| SQS `agentrun-process-dlq` | Dead letter queue |
| Secrets Manager | Slack bot token, GitHub token, Jira token |

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy and configure environment variables in `template.yaml`.

3. Build the Lambda functions:

```bash
npm run build
```

4. Deploy with SAM:

```bash
sam build
sam deploy --guided
```

5. Configure your Slack app:
   - Set the Events API URL to `https://<api-gw-url>/events`
   - Set the Interactivity URL to `https://<api-gw-url>/events`
   - Subscribe to `app_mention` and `message.im` events

6. Configure Claude Code CLI (for MCP server):

```json
{
  "mcpServers": {
    "agentrun": {
      "type": "url",
      "url": "https://<api-gw-url>/mcp?scope=aws",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Pack Manifests

Upload your tool/workflow/skill YAML manifests to S3:

```bash
aws s3 sync .agentrun/manifests/ s3://agentrun-manifests/packs/my-pack/
```

The platform discovers manifests automatically from the S3 bucket during bootstrap.

## Project Structure

```
src/
  setup.ts              # Provider registration (runs once on cold start)
  handlers/
    events.ts           # API Gateway -> Slack events + interactions
    process.ts          # SQS -> query processing + tool execution
    mcp-server.ts       # API Gateway -> MCP JSON-RPC (Claude Code CLI)
template.yaml           # SAM template
esbuild.js              # Build script
package.json
tsconfig.json
```
