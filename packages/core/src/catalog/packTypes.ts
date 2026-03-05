// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { SecretDeclaration } from "../secret/types.js";

// ---------------------------------------------------------------------------
// Pack definition -- metadata for a pack of manifests
// ---------------------------------------------------------------------------

export interface PackDef {
    name: string;
    version: string;
    description: string;
    inherits: string[];
    allowedRoles: string[];
    secrets: SecretDeclaration[];
    // Marketplace metadata (optional)
    author?: string;
    tags?: string[];
    license?: string;
    repository?: string;
    dependencies?: string[];
}

// ---------------------------------------------------------------------------
// Zod schema for pack.yaml validation
// ---------------------------------------------------------------------------

export const SecretDeclarationSchema = z.object({
    name: z.string().min(1),
    provider: z.string().min(1).default("aws-ssm"),
    path: z.string().min(1),
});

export const PackManifestSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("Pack"),
    metadata: z.object({
        name: z.string().min(1),
        version: z.string().min(1).default("1.0.0"),
    }),
    spec: z.object({
        description: z.string().min(1),
        inherits: z.array(z.string().min(1)).default(["core"]),
        allowedRoles: z.array(z.string().min(1)).default(["platform", "tech_lead"]),
        secrets: z.array(SecretDeclarationSchema).default([]),
        // Marketplace metadata (optional)
        author: z.string().optional(),
        tags: z.array(z.string()).optional().default([]),
        license: z.string().optional().default("internal"),
        repository: z.string().url().optional(),
        dependencies: z.array(z.string()).optional().default([]),
    }),
});

// ---------------------------------------------------------------------------
// Zod schemas for remote manifests (same as loader.ts but exported for reuse)
// ---------------------------------------------------------------------------

// Tool access config schemas (NO business logic — just how to reach the capability)
const AwsSdkAccessSchema = z.object({
    service: z.string().min(1),
});

const HttpAccessSchema = z.object({
    baseUrl: z.string().min(1),
    auth: z.object({
        type: z.string().min(1),
        secret: z.string().min(1),
    }).optional(),
});

const LambdaAccessSchema = z.object({
    functionName: z.string().min(1),
    invocationType: z.enum(["RequestResponse", "Event"]).optional(),
});

export const RemoteToolSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("Tool"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        type: z.enum(["mcp-server", "skill", "api-rest", "aws-sdk", "http", "lambda"]).default("mcp-server"),
        mcpTool: z.string().min(1).optional(),
        skillRef: z.string().min(1).optional(),
        description: z.string().min(1),
        category: z.string().min(1),
        // Access config only
        awsSdk: AwsSdkAccessSchema.optional(),
        http: HttpAccessSchema.optional(),
        lambda: LambdaAccessSchema.optional(),
        secrets: z.array(z.string()).optional(),
    }),
});

// Workflow step schema (business logic lives here)
const InputSchemaDefSchema = z.object({
    properties: z.record(z.object({
        type: z.string().default("string"),
        description: z.string().optional(),
        default: z.unknown().optional(),
        enum: z.array(z.string()).optional(),
    })).optional(),
    required: z.array(z.string()).optional(),
});

export const StepSchema = z.object({
    name: z.string().min(1),
    tool: z.string().min(1),
    action: z.string().min(1).optional(),
    input: z.record(z.unknown()).optional(),
    outputTransform: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
});

export const RemoteWorkflowSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("Workflow"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        description: z.string().min(1),
        tools: z.array(z.string().min(1)).min(1),
        steps: z.array(StepSchema).optional(),
        inputSchema: InputSchemaDefSchema.optional(),
    }),
});

export const RemoteUseCaseSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("UseCase"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        description: z.string().min(1),
        keywords: z.array(z.string().min(1)).min(1),
        workflows: z.array(z.string().min(1)).min(1),
        template: z.string().min(1),
    }),
});

export const RemoteKnowledgeBaseSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("KnowledgeBase"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        description: z.string().min(1),
        source: z.object({
            type: z.enum(["markdown", "html", "text"]),
            path: z.string().min(1),
        }),
        chunking: z.object({
            strategy: z.enum(["heading", "fixed", "paragraph"]).default("heading"),
            maxTokens: z.number().int().positive().default(512),
            overlap: z.number().int().nonnegative().default(50),
        }).default({}),
        embedding: z.object({
            model: z.string().default("amazon.titan-embed-text-v2:0"),
            dimensions: z.number().int().positive().default(1024),
        }).default({}),
        tags: z.array(z.string()).optional().default([]),
    }),
});

export const RemoteSkillSchema = z.object({
    apiVersion: z.literal("agentrun/v1"),
    kind: z.literal("Skill"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        command: z.string().min(1),
        description: z.string().min(1),
        prompt: z.string().min(1),
        tools: z.array(z.string().min(1)).min(1),
        allowedRoles: z.array(z.string().min(1)).min(1),
        maxTurns: z.number().int().positive(),
        maxBudgetUsd: z.number().positive(),
        args: z.boolean(),
        mode: z.enum(["direct", "agent"]).default("agent"),
    }),
});

export const UserSkillSchema = z.object({
    apiVersion: z.string(),
    kind: z.literal("UserSkill"),
    metadata: z.object({ name: z.string().min(1) }),
    spec: z.object({
        command: z.string().min(1),
        description: z.string().min(1),
        prompt: z.string().min(1),
    }).passthrough(),
});
