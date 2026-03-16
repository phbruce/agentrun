// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import yaml from "js-yaml";
import { logger } from "../logger.js";
import type { PlatformConfig } from "./types.js";

const ProviderConfigSchema = z.object({
    type: z.string(),
    config: z.record(z.unknown()).default({}),
});

const RoleDefSchema = z.object({
    actions: z.array(z.string()),
    useCases: z.array(z.string()),
    persona: z.string(),
    capabilities: z.string().optional(),
    maxTurns: z.number().int().min(1).max(50),
    maxBudgetUsd: z.number().min(0).max(10),
});

const UserEntrySchema = z.object({
    externalId: z.string(),
    source: z.string(),
    name: z.string(),
    role: z.string(),
    packs: z.array(z.string()).optional(),
});

const ResourceEntrySchema = z.object({
    type: z.string(),
    name: z.string(),
    description: z.string(),
});

const RepoEntrySchema = z.object({
    name: z.string(),
    description: z.string(),
});

const PlatformConfigSchema = z.object({
    apiVersion: z.string().default("agentrun/v1"),
    kind: z.string().default("PlatformConfig"),
    metadata: z.object({ name: z.string() }),
    spec: z.object({
        providers: z.object({
            llm: ProviderConfigSchema,
            credentials: ProviderConfigSchema,
            session: ProviderConfigSchema,
            usage: ProviderConfigSchema,
            manifests: ProviderConfigSchema,
            queue: ProviderConfigSchema,
            secrets: ProviderConfigSchema,
            embeddings: ProviderConfigSchema.optional(),
            vectorStore: ProviderConfigSchema.optional(),
            knowledgeBase: ProviderConfigSchema.optional(),
        }),
        identity: z.object({
            sources: z.array(z.object({
                type: z.string(),
                org: z.string().optional(),
                teamRoleMapping: z.record(z.string()).optional(),
                defaultRole: z.string().optional(),
            })),
        }),
        roles: z.record(RoleDefSchema),
        users: z.array(UserEntrySchema),
        environment: z.object({
            name: z.string(),
            cloud: z.string(),
            account: z.string(),
            region: z.string(),
            env: z.string(),
            resources: z.array(ResourceEntrySchema),
            repos: z.array(RepoEntrySchema),
        }),
    }),
});

/**
 * Load platform config from:
 * 1. AGENTRUN_CONFIG_INLINE env var (JSON/YAML string — for testing)
 * 2. AGENTRUN_PLATFORM_CONFIG env var (S3 key in manifests bucket)
 * 3. null (no config — caller should use buildDefaultConfig())
 */
export async function loadPlatformConfig(): Promise<PlatformConfig | null> {
    // Option 1: inline JSON/YAML (testing / local dev)
    const inline = process.env.AGENTRUN_CONFIG_INLINE;
    if (inline) {
        try {
            const parsed = inline.trim().startsWith("{") ? JSON.parse(inline) : yaml.load(inline);
            const config = PlatformConfigSchema.parse(parsed) as PlatformConfig;
            logger.info({ name: config.metadata.name }, "Platform config loaded from AGENTRUN_CONFIG_INLINE");
            return config;
        } catch (err: any) {
            logger.error({ error: err.message }, "Failed to parse AGENTRUN_CONFIG_INLINE");
            throw new Error(`Invalid AGENTRUN_CONFIG_INLINE: ${err.message}`);
        }
    }

    // Option 2: S3 key (production)
    const s3Key = process.env.AGENTRUN_PLATFORM_CONFIG;
    if (s3Key) {
        try {
            const { PlatformRegistry } = await import("./registry.js");
            const registry = PlatformRegistry.instance();

            // If manifests provider is already registered (e.g., during bootstrap),
            // use it to fetch the config file
            if (registry.isConfigured) {
                const content = await registry.manifests.getFile(s3Key);
                if (content) {
                    const parsed = yaml.load(content);
                    const config = PlatformConfigSchema.parse(parsed) as PlatformConfig;
                    logger.info({ name: config.metadata.name, s3Key }, "Platform config loaded from manifests store");
                    return config;
                }
            }

            // Otherwise, load directly from S3 (first boot — manifests provider not yet registered)
            const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
            const bucket = process.env.AGENTRUN_MANIFESTS_BUCKET ?? "agentrun-manifests";
            const s3 = new S3Client({});
            const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
            const body = await res.Body?.transformToString();
            if (body) {
                const parsed = yaml.load(body);
                const config = PlatformConfigSchema.parse(parsed) as PlatformConfig;
                logger.info({ name: config.metadata.name, s3Key }, "Platform config loaded from S3 (direct)");
                return config;
            }
        } catch (err: any) {
            logger.error({ error: err.message, s3Key }, "Failed to load platform config from S3");
            throw new Error(`Failed to load platform config from S3 key ${s3Key}: ${err.message}`);
        }
    }

    // Option 3: no config — caller should use buildDefaultConfig()
    logger.info("No platform config found (AGENTRUN_PLATFORM_CONFIG and AGENTRUN_CONFIG_INLINE not set). Using defaults.");
    return null;
}

/**
 * Build a minimal default PlatformConfig.
 * Used as fallback when no config file is provided.
 * Deployers should provide a full config via AGENTRUN_PLATFORM_CONFIG or AGENTRUN_CONFIG_INLINE.
 */
export function buildDefaultConfig(): PlatformConfig {
    const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? "000000000000";
    const REGION = process.env.AWS_REGION ?? "us-east-1";

    return {
        apiVersion: "agentrun/v1",
        kind: "PlatformConfig",
        metadata: { name: process.env.AGENTRUN_NAME ?? "agentrun" },
        spec: {
            providers: {
                llm: { type: "bedrock", config: { region: REGION, defaultModel: process.env.AGENTRUN_DEFAULT_MODEL ?? "us.anthropic.claude-sonnet-4-20250514-v1:0", complexModel: process.env.AGENTRUN_COMPLEX_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0" } },
                credentials: { type: "aws-sts", config: { region: REGION, roleArnPattern: `arn:aws:iam::${ACCOUNT_ID}:role/agentrun-role-{{ role }}` } },
                session: { type: "dynamodb", config: { tableName: process.env.AGENTRUN_SESSIONS_TABLE ?? "agentrun-sessions", ttlDays: 7 } },
                usage: { type: "dynamodb", config: { tableName: process.env.AGENTRUN_USAGE_TABLE ?? "agentrun-usage" } },
                manifests: { type: "s3", config: { bucket: process.env.AGENTRUN_MANIFESTS_BUCKET ?? "agentrun-manifests" } },
                queue: { type: "sqs", config: { region: REGION, accountId: ACCOUNT_ID } },
                secrets: { type: "aws-secrets-manager", config: {} },
            },
            identity: {
                sources: [
                    { type: "github", org: process.env.AGENTRUN_GITHUB_ORG ?? "my-org", defaultRole: "viewer" },
                    { type: "slack" },
                ],
            },
            roles: {
                admin: { actions: ["infra:query", "infra:write", "infra:admin"], useCases: ["infra-health", "lambda-debug", "cluster-status", "database-status", "code-review", "deployment-tracking", "log-investigation", "sqs-monitor"], persona: "Full technical detail. Show configs, ARNs, metrics, and correlate across services.", capabilities: "Full access", maxTurns: 15, maxBudgetUsd: 0.5 },
                operator: { actions: ["infra:query", "infra:write"], useCases: ["infra-health", "lambda-debug", "cluster-status", "database-status", "code-review", "deployment-tracking", "log-investigation", "sqs-monitor"], persona: "Complete technical detail. Show configs, versions, diffs, and relevant metrics.", capabilities: "Full read + limited write", maxTurns: 15, maxBudgetUsd: 0.5 },
                developer: { actions: ["infra:query"], useCases: ["lambda-debug", "code-review", "deployment-tracking", "log-investigation"], persona: "Focus on what impacts day-to-day development: functions, PRs, and logs.", capabilities: "Functions, Logs, PRs, Commits", maxTurns: 10, maxBudgetUsd: 0.3 },
                viewer: { actions: ["infra:query"], useCases: ["infra-health", "cluster-status", "database-status"], persona: "Concise, direct responses. Basic health and listing queries only.", capabilities: "Read-only health checks", maxTurns: 8, maxBudgetUsd: 0.3 },
            },
            users: [],
            environment: {
                name: process.env.AGENTRUN_NAME ?? "My Platform",
                cloud: "aws",
                account: ACCOUNT_ID,
                region: REGION,
                env: process.env.AGENTRUN_ENV ?? "prd",
                resources: [],
                repos: [],
            },
        },
    };
}
