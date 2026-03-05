// SPDX-License-Identifier: AGPL-3.0-only

import { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "@agentrun-oss/core";
import type { ToolHandler, ResolvedSecrets } from "@agentrun-oss/core";
import type { ToolDef, WorkflowDef, InputSchemaDef } from "@agentrun-oss/core";
import { executeWorkflow } from "./workflowEngine.js";

// ---------------------------------------------------------------------------
// Input schema -> Zod (runtime)
// ---------------------------------------------------------------------------

interface PropertyDef {
    type: string;
    description?: string;
    default?: unknown;
    enum?: string[];
}

function zodTypeForProperty(prop: PropertyDef): ZodTypeAny {
    let schema: ZodTypeAny;
    switch (prop.type) {
        case "number":
        case "integer":
            schema = z.number();
            break;
        case "boolean":
            schema = z.boolean();
            break;
        case "string":
        default:
            schema = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
            break;
    }
    if (prop.description) {
        schema = schema.describe(prop.description);
    }
    return schema;
}

export function buildZodSchema(inputSchema?: InputSchemaDef): Record<string, ZodTypeAny> {
    if (!inputSchema?.properties) return {};

    const required = new Set(inputSchema.required ?? []);
    const shape: Record<string, ZodTypeAny> = {};

    for (const [name, prop] of Object.entries(inputSchema.properties)) {
        let field = zodTypeForProperty({ type: prop.type ?? "string", ...prop });
        if (!required.has(name)) {
            field = field.optional();
        }
        shape[name] = field;
    }

    return shape;
}

// ---------------------------------------------------------------------------
// Hydrate a catalog tool definition into a registry tool (backward compat)
// Tools with type aws-sdk/http/lambda that are NOT used via workflow steps
// can still be called directly if they have no business logic to decompose.
// ---------------------------------------------------------------------------

export function hydrateDeclarativeTool(
    catalogTool: ToolDef,
    secrets: ResolvedSecrets,
): ToolHandler | null {
    // With the new architecture, standalone declarative tools (without workflow steps)
    // are just capability registrations. They don't have handlers on their own.
    // Only workflows-with-steps produce callable MCP tools.
    // Return null to signal "not directly callable".
    const { type, name } = catalogTool;
    if (type === "aws-sdk" || type === "http" || type === "lambda") {
        logger.debug({ tool: name, type }, "Declarative tool registered as capability (callable via workflow steps)");
        return null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Batch hydration: process all declarative tools from a catalog
// (Backward compat -- now returns empty since tools are capabilities only)
// ---------------------------------------------------------------------------

export function hydrateDeclarativeTools(
    catalog: { tools: Map<string, ToolDef> },
    secrets: ResolvedSecrets,
): Map<string, ToolHandler> {
    // Declarative tools no longer register directly -- they're capabilities
    // used by workflow steps. Return empty map for backward compat.
    return new Map();
}

// ---------------------------------------------------------------------------
// Hydrate workflows-with-steps as callable MCP tools
// ---------------------------------------------------------------------------

export function hydrateWorkflowAsTools(
    catalog: { tools: Map<string, ToolDef>; workflows: Map<string, WorkflowDef> },
    secrets: ResolvedSecrets,
): Map<string, ToolHandler> {
    const hydrated = new Map<string, ToolHandler>();

    for (const [name, workflow] of catalog.workflows) {
        if (!workflow.steps || workflow.steps.length === 0) {
            continue; // flat workflows (RBAC filters) -- skip
        }

        try {
            const zodShape = buildZodSchema(workflow.inputSchema);
            const jsonSchema = Object.keys(zodShape).length > 0
                ? zodToJsonSchema(z.object(zodShape), { target: "jsonSchema7" })
                : { type: "object", properties: {} };

            const handler = async (args: any, _extra: unknown) => {
                const result = await executeWorkflow(
                    workflow.steps!,
                    args ?? {},
                    secrets,
                    catalog.tools,
                );

                // Format all step results as text content
                const text = JSON.stringify(result.results, null, 2);
                return {
                    content: [{ type: "text" as const, text }],
                };
            };

            const toolHandler: ToolHandler & { description: string; inputSchema: any } = {
                name,
                description: workflow.description,
                inputSchema: jsonSchema,
                handler,
            };

            hydrated.set(name, toolHandler);
            logger.info({ workflow: name, steps: workflow.steps.length }, "Hydrated workflow as callable MCP tool");
        } catch (err: any) {
            logger.warn({ workflow: name, error: err.message }, "Failed to hydrate workflow as tool, skipping");
        }
    }

    return hydrated;
}
