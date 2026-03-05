// SPDX-License-Identifier: AGPL-3.0-only

import { interpolate } from "./templateInterpolator.js";
import { applyOutputTransform } from "./outputTransform.js";
import {
    validateAwsSdkAction,
    validateHttpUrl,
    validateLambdaName,
} from "./allowlists.js";
import type { ResolvedSecrets } from "@agentrun-oss/core";

// ---------------------------------------------------------------------------
// Declarative spec shapes (parsed from YAML)
// ---------------------------------------------------------------------------

export interface AwsSdkSpec {
    service: string;
    action: string;
    input?: Record<string, unknown>;
}

export interface HttpSpec {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
}

export interface LambdaSpec {
    functionName: string;
    invocationType?: "RequestResponse" | "Event";
}

// ---------------------------------------------------------------------------
// AWS SDK executor
// ---------------------------------------------------------------------------

export async function executeAwsSdk(
    spec: AwsSdkSpec,
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
    outputTransform?: string,
    timeoutMs?: number,
): Promise<unknown> {
    validateAwsSdkAction(spec.service, spec.action);

    const interpolatedInput = interpolate(spec.input ?? {}, args, secrets) as Record<string, unknown>;

    // Dynamic import of the AWS SDK client for the requested service
    const client = await createAwsSdkClient(spec.service);
    const command = await createAwsSdkCommand(spec.service, spec.action, interpolatedInput);

    const abortController = new AbortController();
    const timer = timeoutMs ? setTimeout(() => abortController.abort(), timeoutMs) : undefined;

    try {
        const result = await client.send(command, { abortSignal: abortController.signal });
        // Strip SDK metadata from response
        const { $metadata, ...data } = result as any;
        return applyOutputTransform(data, outputTransform);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// HTTP executor
// ---------------------------------------------------------------------------

export async function executeHttp(
    spec: HttpSpec,
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
    outputTransform?: string,
    timeoutMs?: number,
): Promise<unknown> {
    const url = interpolate(spec.url, args, secrets) as string;
    validateHttpUrl(url);

    const headers = (spec.headers ? interpolate(spec.headers, args, secrets) : {}) as Record<string, string>;
    const body = spec.body ? interpolate(spec.body, args, secrets) : undefined;

    const abortController = new AbortController();
    const timer = timeoutMs ? setTimeout(() => abortController.abort(), timeoutMs) : undefined;

    try {
        const response = await fetch(url, {
            method: spec.method,
            headers: { "Content-Type": "application/json", ...headers },
            body: body ? JSON.stringify(body) : undefined,
            signal: abortController.signal,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        const data = contentType.includes("json") ? await response.json() : await response.text();
        return applyOutputTransform(data, outputTransform);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Lambda executor
// ---------------------------------------------------------------------------

export async function executeLambda(
    spec: LambdaSpec,
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
    outputTransform?: string,
    timeoutMs?: number,
): Promise<unknown> {
    const functionName = interpolate(spec.functionName, args, secrets) as string;
    validateLambdaName(functionName);

    const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
    const client = new LambdaClient({});

    const payload = new TextEncoder().encode(JSON.stringify(args));

    const abortController = new AbortController();
    const timer = timeoutMs ? setTimeout(() => abortController.abort(), timeoutMs) : undefined;

    try {
        const result = await client.send(
            new InvokeCommand({
                FunctionName: functionName,
                InvocationType: spec.invocationType ?? "RequestResponse",
                Payload: payload,
            }),
            { abortSignal: abortController.signal },
        );

        if (result.FunctionError) {
            const errorPayload = result.Payload ? new TextDecoder().decode(result.Payload) : "unknown error";
            throw new Error(`Lambda invocation error (${result.FunctionError}): ${errorPayload.slice(0, 1000)}`);
        }

        const responseText = result.Payload ? new TextDecoder().decode(result.Payload) : "{}";
        let data: unknown;
        try {
            data = JSON.parse(responseText);
        } catch {
            data = responseText;
        }

        return applyOutputTransform(data, outputTransform);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// AWS SDK dynamic client/command helpers
// ---------------------------------------------------------------------------

const SERVICE_MODULE_MAP: Record<string, string> = {
    S3: "@aws-sdk/client-s3",
    Lambda: "@aws-sdk/client-lambda",
    EKS: "@aws-sdk/client-eks",
    RDS: "@aws-sdk/client-rds",
    CloudWatchLogs: "@aws-sdk/client-cloudwatch-logs",
    SQS: "@aws-sdk/client-sqs",
    CostExplorer: "@aws-sdk/client-cost-explorer",
    CloudWatch: "@aws-sdk/client-cloudwatch",
    DynamoDB: "@aws-sdk/client-dynamodb",
    SecretsManager: "@aws-sdk/client-secrets-manager",
    SSM: "@aws-sdk/client-ssm",
};

async function createAwsSdkClient(service: string): Promise<any> {
    const moduleName = SERVICE_MODULE_MAP[service];
    if (!moduleName) {
        throw new Error(`No SDK module mapping for service: ${service}`);
    }

    const mod = await import(moduleName);

    // Client class follows pattern: {Service}Client (e.g., S3Client, EKSClient)
    const clientClassName = `${service}Client`;
    const ClientClass = mod[clientClassName];
    if (!ClientClass) {
        throw new Error(`Client class "${clientClassName}" not found in ${moduleName}`);
    }

    return new ClientClass({});
}

async function createAwsSdkCommand(service: string, action: string, input: Record<string, unknown>): Promise<any> {
    const moduleName = SERVICE_MODULE_MAP[service];
    if (!moduleName) {
        throw new Error(`No SDK module mapping for service: ${service}`);
    }

    const mod = await import(moduleName);

    // Command class follows pattern: {Action}Command (e.g., GetCostAndUsageCommand)
    const commandClassName = `${action}Command`;
    const CommandClass = mod[commandClassName];
    if (!CommandClass) {
        throw new Error(`Command class "${commandClassName}" not found in ${moduleName}. Check the action name.`);
    }

    return new CommandClass(input);
}
