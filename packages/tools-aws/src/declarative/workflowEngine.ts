// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";
import type { ToolDef, WorkflowStep, ResolvedSecrets } from "@agentrun-ai/core";
import { interpolate } from "./templateInterpolator.js";
import { applyOutputTransform } from "./outputTransform.js";
import {
    executeAwsSdk,
    executeHttp,
    executeLambda,
    type AwsSdkSpec,
    type HttpSpec,
    type LambdaSpec,
} from "./declarativeExecutor.js";

// ---------------------------------------------------------------------------
// Workflow execution context
// ---------------------------------------------------------------------------

interface WorkflowExecContext {
    args: Record<string, unknown>;
    secrets: ResolvedSecrets;
    toolRegistry: Map<string, ToolDef>;
    stepResults: Map<string, unknown>;
}

export interface WorkflowResult {
    results: Record<string, unknown>;
    steps: string[];
}

// ---------------------------------------------------------------------------
// Step execution: dispatches to the right executor based on tool type
// ---------------------------------------------------------------------------

async function executeStep(
    step: WorkflowStep,
    context: WorkflowExecContext,
): Promise<unknown> {
    const tool = context.toolRegistry.get(step.tool);
    if (!tool) {
        throw new Error(`Workflow step "${step.name}" references unknown tool: ${step.tool}`);
    }

    // Build interpolation context: workflow args + builtins + step results
    const interpolationArgs: Record<string, unknown> = {
        ...context.args,
        steps: Object.fromEntries(
            Array.from(context.stepResults.entries()).map(([k, v]) => [k, { result: v }]),
        ),
    };

    const interpolatedInput = step.input
        ? interpolate(step.input, interpolationArgs, context.secrets) as Record<string, unknown>
        : {};

    switch (tool.type) {
        case "aws-sdk": {
            if (!tool.awsSdk) {
                throw new Error(`Tool "${tool.name}" is aws-sdk but missing awsSdk config`);
            }
            const spec: AwsSdkSpec = {
                service: tool.awsSdk.service,
                action: step.action ?? "",
                input: interpolatedInput,
            };
            if (!spec.action) {
                throw new Error(`Workflow step "${step.name}" must specify an action for aws-sdk tool "${tool.name}"`);
            }
            return executeAwsSdk(spec, {}, context.secrets, step.outputTransform, step.timeoutMs);
        }

        case "http": {
            if (!tool.http) {
                throw new Error(`Tool "${tool.name}" is http but missing http config`);
            }
            // Build URL from tool baseUrl + step action (e.g., "GET /invoices")
            const [method, ...pathParts] = (step.action ?? "GET").split(" ");
            const path = pathParts.join(" ").trim();
            const url = path ? `${tool.http.baseUrl}${path}` : tool.http.baseUrl;

            // Resolve auth header from secrets
            const headers: Record<string, string> = {};
            if (tool.http.auth) {
                const secret = context.secrets.get(tool.http.auth.secret);
                if (secret) {
                    if (tool.http.auth.type === "bearer") {
                        headers["Authorization"] = `Bearer ${secret}`;
                    } else if (tool.http.auth.type === "basic") {
                        headers["Authorization"] = `Basic ${secret}`;
                    }
                }
            }

            const spec: HttpSpec = {
                method: method.toUpperCase(),
                url,
                headers,
                body: Object.keys(interpolatedInput).length > 0 ? interpolatedInput : undefined,
            };
            return executeHttp(spec, {}, context.secrets, step.outputTransform, step.timeoutMs);
        }

        case "lambda": {
            if (!tool.lambda) {
                throw new Error(`Tool "${tool.name}" is lambda but missing lambda config`);
            }
            const spec: LambdaSpec = {
                functionName: tool.lambda.functionName,
                invocationType: tool.lambda.invocationType,
            };
            return executeLambda(spec, interpolatedInput, context.secrets, step.outputTransform, step.timeoutMs);
        }

        default:
            throw new Error(`Workflow step "${step.name}" references tool "${tool.name}" with unsupported type: ${tool.type}`);
    }
}

// ---------------------------------------------------------------------------
// Workflow executor: runs steps sequentially, chains results
// ---------------------------------------------------------------------------

export async function executeWorkflow(
    steps: WorkflowStep[],
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
    toolRegistry: Map<string, ToolDef>,
): Promise<WorkflowResult> {
    const context: WorkflowExecContext = {
        args,
        secrets,
        toolRegistry,
        stepResults: new Map(),
    };

    const executedSteps: string[] = [];

    for (const step of steps) {
        logger.info({ step: step.name, tool: step.tool, action: step.action }, "Executing workflow step");

        try {
            const result = await executeStep(step, context);
            context.stepResults.set(step.name, result);
            executedSteps.push(step.name);

            logger.info({ step: step.name }, "Workflow step completed");
        } catch (err: any) {
            logger.error({ step: step.name, error: err.message }, "Workflow step failed");
            throw new Error(`Workflow step "${step.name}" failed: ${err.message}`);
        }
    }

    return {
        results: Object.fromEntries(context.stepResults),
        steps: executedSteps,
    };
}
