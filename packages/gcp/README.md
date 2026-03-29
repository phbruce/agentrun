# @agentrun-ai/gcp

GCP provider implementations for AgentRun: Vertex AI, Firestore, Cloud Storage, Pub/Sub, Secret Manager, Cloud KMS.

Use this package to run AgentRun on Google Cloud Platform.

## Installation

```bash
npm install @agentrun-ai/core @agentrun-ai/gcp
```

## Quick Start

```typescript
import { setProviderRegistrar, bootstrapPlatform } from "@agentrun-ai/core";
import { registerGcpProviders } from "@agentrun-ai/gcp";

setProviderRegistrar(registerGcpProviders);
await bootstrapPlatform();
```

That's it. All providers are automatically registered from your config.

## Provider Implementations

| Interface | Implementation |
|-----------|-----------------|
| `LlmProvider` | Vertex AI (claude-3-opus, gemini-2.0-pro, etc.) |
| `SessionStore` | Firestore |
| `UsageStore` | Firestore |
| `ManifestStore` | Cloud Storage |
| `QueueProvider` | Pub/Sub |
| `BootstrapSecretProvider` | Secret Manager |
| `EmbeddingProvider` | Vertex AI Embeddings |
| `VectorStore` | pgvector (Cloud SQL PostgreSQL) |
| `KnowledgeBaseProvider` | Vertex AI Search |
| `UserTokenStore` | Firestore with Cloud KMS encryption (v0.4.0) |

## Token Store with KMS Encryption (v0.4.0)

Store per-user OAuth tokens securely in Firestore with optional Cloud KMS envelope encryption:

```typescript
import { FirestoreUserTokenStore } from "@agentrun-ai/gcp";

const tokenStore = new FirestoreUserTokenStore(
    "agentrun-user-tokens",    // Firestore collection name
    "default-db",              // Firestore database ID (optional)
    "projects/my-project/locations/us/keyRings/my-ring/cryptoKeys/my-key"  // KMS key (optional)
);

// Save token
await tokenStore.saveToken("U12345", "google", {
    accessToken: "ya29...",
    refreshToken: "1//...",
    expiresAt: Date.now() + 3600000,
    tokenType: "bearer",
});

// Retrieve token (decrypted automatically)
const token = await tokenStore.getToken("U12345", "google");
// → { accessToken: "ya29...", refreshToken: "1//...", ... }

// List providers for user
const providers = await tokenStore.listProviders("U12345");
// → ["google", "github", "gitlab"]

// Delete token
await tokenStore.deleteToken("U12345", "google");
```

**Document Structure:**
```
Firestore:
  agentrun-user-tokens/
    {userId}/
      providers/
        {providerName}/
          accessToken: <encrypted if KMS enabled>
          refreshToken: <encrypted if KMS enabled>
          idToken: <encrypted if KMS enabled>
          expiresAt: 1234567890000  (plaintext, queryable)
          tokenType: "bearer"
          scopes: ["scope1", "scope2"]
          savedAt: 1234567890000
          encrypted: true/false
```

**Encryption:**
- Sensitive fields (accessToken, refreshToken, idToken) are encrypted with Cloud KMS
- Metadata fields (expiresAt, tokenType, scopes) stored plaintext for indexing
- Encryption is optional — omit KMS key for plaintext storage

**KMS Setup:**
```bash
# Create key ring
gcloud kms keyrings create agentrun --location=us

# Create crypto key
gcloud kms keys create user-tokens --location=us --keyring=agentrun --purpose=encryption

# Get key name for config
gcloud kms keys list --location=us --keyring=agentrun
# → projects/MY_PROJECT/locations/us/keyRings/agentrun/cryptoKeys/user-tokens

# Grant service account KMS permissions
gcloud kms keys add-iam-policy-binding user-tokens \
    --location=us \
    --keyring=agentrun \
    --member=serviceAccount:my-sa@my-project.iam.gserviceaccount.com \
    --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```

## Configuration

In your platform config:

```yaml
spec:
  providers:
    gcp:
      project: my-project
      location: us
      firestoreDb: default-db
      kmsKeyName: projects/my-project/locations/us/keyRings/agentrun/cryptoKeys/user-tokens

  models:
    fast:
      provider: vertex-ai
      modelId: gemini-1.5-flash
      capability: fast

    advanced:
      provider: vertex-ai
      modelId: gemini-2.0-pro
      capability: advanced

  roles:
    engineer:
      models: [fast, advanced]
```

Or via environment variables:
```bash
AGENTRUN_GCP_PROJECT=my-project
AGENTRUN_KMS_KEY=projects/my-project/locations/us/keyRings/agentrun/cryptoKeys/user-tokens
AGENTRUN_FIRESTORE_DB=default-db
```

## Vertex AI Models

Compatible models for GenericAgentConfig:

```typescript
import { createOpenAICaller } from "@agentrun-ai/core";

// Use with Vertex AI SDK (already integrated in VertexAiLlmProvider)
// Or use OpenAI-compatible gateway for Vertex AI:

const caller = createOpenAICaller({
    baseUrl: "https://REGION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/REGION",
    defaultModel: "gemini-2.0-flash",
    resolveToken: async () => {
        // Vertex AI uses OAuth2 bearer tokens
        return await getVertexAIToken();
    },
});
```

## Cloud SQL (pgvector) Setup

For RAG vector search:

```bash
# Create Cloud SQL PostgreSQL instance
gcloud sql instances create agentrun-pgvector \
    --database-version=POSTGRES_16 \
    --region=us-central1 \
    --tier=db-custom-2-8192

# Enable pgvector extension
gcloud sql connect agentrun-pgvector -- \
    -U postgres \
    -d postgres \
    -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Create vector table
gcloud sql connect agentrun-pgvector -- \
    -U postgres \
    -d postgres \
    << EOF
CREATE TABLE knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    pack_id TEXT NOT NULL,
    source TEXT,
    content TEXT,
    embedding VECTOR(768),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
EOF
```

## Deployment

### Cloud Run

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --production
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

```bash
gcloud run deploy agentrun \
    --source . \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --service-account agentrun-sa@my-project.iam.gserviceaccount.com \
    --update-secrets SLACK_BOT_TOKEN=slack-bot-token:latest \
    --update-secrets SLACK_SIGNING_SECRET=slack-signing-secret:latest
```

### Cloud Functions

```typescript
import { registerGcpProviders } from "@agentrun-ai/gcp";

export async function slackEvent(req, res) {
    setProviderRegistrar(registerGcpProviders);
    await bootstrapPlatform();

    const adapter = new SlackChannelAdapter();
    await processRequest(adapter, req.body);
    res.status(200).send("OK");
}
```

## See Also

- [`@agentrun-ai/core`](../core) — Core runtime
- [`@agentrun-ai/aws`](../aws) — AWS provider
- [AgentRun README](../../README.md) — Full documentation
