// SPDX-License-Identifier: AGPL-3.0-only
export type ToolType = "mcp-server" | "skill" | "api-rest" | "aws-sdk" | "http" | "lambda";

export interface ToolDef {
    name: string;
    type: ToolType;
    mcpTool?: string;
    skillRef?: string;
    description: string;
    category: string;
    // Access config (how to reach the capability — NO business logic)
    awsSdk?: { service: string };
    http?: { baseUrl: string; auth?: { type: string; secret: string } };
    lambda?: { functionName: string; invocationType?: "RequestResponse" | "Event" };
    secrets?: string[];
}

export interface InputSchemaDef {
    properties?: Record<string, {
        type?: string;
        description?: string;
        default?: unknown;
        enum?: string[];
    }>;
    required?: string[];
}

export interface WorkflowStep {
    name: string;
    tool: string;
    action?: string;
    input?: Record<string, unknown>;
    outputTransform?: string;
    timeoutMs?: number;
}

export interface WorkflowDef {
    name: string;
    description: string;
    tools: string[];
    steps?: WorkflowStep[];
    inputSchema?: InputSchemaDef;
}

export interface UseCaseDef {
    name: string;
    description: string;
    keywords: string[];
    workflows: string[];
    template: string;
}

export interface SkillDef {
    name: string;
    command: string;
    description: string;
    prompt: string;
    tools: string[];
    allowedRoles: string[];
    maxTurns: number;
    maxBudgetUsd: number;
    args: boolean;
    mode: "direct" | "agent";
}

export interface KnowledgeBaseDef {
    name: string;
    description: string;
    source: {
        type: "markdown" | "html" | "text";
        path: string;
    };
    chunking: {
        strategy: "heading" | "fixed" | "paragraph";
        maxTokens: number;
        overlap: number;
    };
    embedding: {
        model: string;
        dimensions: number;
    };
    tags: string[];
}

export interface ManifestCatalog {
    tools: Map<string, ToolDef>;
    workflows: Map<string, WorkflowDef>;
    useCases: Map<string, UseCaseDef>;
    skills: Map<string, SkillDef>;
    knowledgeBases: Map<string, KnowledgeBaseDef>;
}
