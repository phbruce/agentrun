// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "../logger.js";
import { getToolRegistry } from "../mcp/registry.js";
import { summarizeToolResults } from "./bedrockClient.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { AgentResult } from "./agentRunner.js";
import type { SkillDef } from "../catalog/types.js";
import { getIdentityProvider } from "../identity/index.js";
import { createClientsForIdentity } from "../mcp/clientFactory.js";
import type { AwsClients } from "../mcp/clientFactory.js";
import { loadCatalogForPacks } from "../catalog/packLoader.js";
import { hydrateDeclarativeTool, hydrateWorkflowAsTools } from "../mcp/declarative.js";
import { PlatformRegistry } from "../platform/registry.js";

interface ToolResult {
    toolName: string;
    result: string;
}

// Cache for lazily-hydrated tools during a skill execution
const _hydratedToolCache = new Map<string, { name: string; handler: (args: any, extra: unknown) => Promise<any> }>();

async function callTool(name: string, args: Record<string, any> = {}, awsClients?: AwsClients): Promise<string> {
    const registry = getToolRegistry(awsClients);
    let tool = registry.get(name) ?? _hydratedToolCache.get(name);

    // Fallback: try to hydrate from pack catalog (workflow-based tools + legacy declarative)
    if (!tool) {
        try {
            const catalog = await loadCatalogForPacks(["core"]);

            // Try workflow-based tools first (workflows with steps)
            const workflowTools = hydrateWorkflowAsTools(catalog, new Map());
            for (const [toolName, wfTool] of workflowTools) {
                _hydratedToolCache.set(toolName, wfTool);
            }
            tool = _hydratedToolCache.get(name);

            // Legacy fallback: standalone declarative tool
            if (!tool) {
                const catalogTool = catalog.tools.get(name);
                if (catalogTool && (catalogTool.type === "aws-sdk" || catalogTool.type === "http" || catalogTool.type === "lambda")) {
                    const hydrated = hydrateDeclarativeTool(catalogTool, new Map());
                    if (hydrated) {
                        _hydratedToolCache.set(name, hydrated);
                        tool = hydrated;
                    }
                }
            }
        } catch (err: any) {
            logger.warn({ tool: name, error: err.message }, "Failed to hydrate tool in direct executor");
        }
    }

    if (!tool) {
        throw new Error(`Tool not found in registry: ${name}`);
    }

    const response = await tool.handler(args, null);
    const texts = (response.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text);
    return texts.join("\n");
}

/** Read EKS cluster name from platform config. */
function getEksClusterName(): string {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const eks = registry.config.spec.environment.resources.find((r) => r.type === "eks");
            if (eks) return eks.name;
        }
    } catch { /* not configured */ }
    return process.env.AGENTRUN_EKS_CLUSTER ?? "my-cluster";
}

/** Read SQS name prefix from platform config or env var. */
function getSqsPrefix(): string {
    return process.env.AGENTRUN_SQS_PREFIX ?? "";
}

/** Read repo list from platform config. */
function getRepoNames(): string[] {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            return registry.config.spec.environment.repos.map((r) => r.name);
        }
    } catch { /* not configured */ }
    return [];
}

// ---------------------------------------------------------------------------
// Health Check: EKS + RDS + Lambdas + SQS DLQs
// ---------------------------------------------------------------------------
async function executeHealthCheck(awsClients?: AwsClients): Promise<ToolResult[]> {
    const clusterName = getEksClusterName();
    const sqsPrefix = getSqsPrefix();

    // Parallel: independent AWS queries
    const [eksResult, rdsResult, lambdasResult, sqsResult] = await Promise.all([
        callTool("describe_eks_cluster", { clusterName }, awsClients),
        callTool("describe_rds", {}, awsClients),
        callTool("list_lambdas", {}, awsClients),
        callTool("list_sqs_queues", { namePrefix: sqsPrefix }, awsClients),
    ]);

    const results: ToolResult[] = [
        { toolName: "describe_eks_cluster", result: eksResult },
        { toolName: "describe_rds", result: rdsResult },
        { toolName: "list_lambdas", result: lambdasResult },
        { toolName: "list_sqs_queues", result: sqsResult },
    ];

    // Sequential: check each DLQ for messages
    const sqsData = JSON.parse(sqsResult);
    const dlqQueues = (sqsData.queues ?? []).filter((q: any) => q.name.endsWith("-dlq"));

    for (const dlq of dlqQueues) {
        const attrs = await callTool("get_sqs_attributes", { queueName: dlq.url }, awsClients);
        results.push({ toolName: "get_sqs_attributes", result: attrs });
    }

    return results;
}

// ---------------------------------------------------------------------------
// DLQ Alert: list queues, filter DLQs, check each
// ---------------------------------------------------------------------------
async function executeDlqAlert(awsClients?: AwsClients): Promise<ToolResult[]> {
    const sqsPrefix = getSqsPrefix();
    const sqsResult = await callTool("list_sqs_queues", { namePrefix: sqsPrefix }, awsClients);
    const results: ToolResult[] = [{ toolName: "list_sqs_queues", result: sqsResult }];

    const sqsData = JSON.parse(sqsResult);
    const dlqQueues = (sqsData.queues ?? []).filter((q: any) => q.name.endsWith("-dlq"));

    for (const dlq of dlqQueues) {
        const attrs = await callTool("get_sqs_attributes", { queueName: dlq.url }, awsClients);
        results.push({ toolName: "get_sqs_attributes", result: attrs });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Deploy Status: PRs + commits across repos
// ---------------------------------------------------------------------------
async function executeDeployStatus(_awsClients?: AwsClients): Promise<ToolResult[]> {
    const repos = getRepoNames();

    const calls = repos.flatMap((repo) => [
        callTool("list_open_prs", { repo }).then((r) => ({ toolName: "list_open_prs", result: r })),
        callTool("recent_commits", { repo, branch: "main", count: 5 }).then((r) => ({ toolName: "recent_commits", result: r })),
    ]);

    return Promise.all(calls);
}

// ---------------------------------------------------------------------------
// Executor dispatch
// ---------------------------------------------------------------------------
type Executor = (awsClients?: AwsClients) => Promise<ToolResult[]>;

const EXECUTORS: Record<string, Executor> = {
    "health-check": executeHealthCheck,
    "dlq-alert": executeDlqAlert,
    "deploy-status": executeDeployStatus,
};

export async function processDirectSkill(
    skill: SkillDef,
    _args: string,
    userId: string,
    model: string,
): Promise<AgentResult> {
    const startTime = Date.now();

    logger.info({ userId, skill: skill.command, model }, "Direct skill starting");

    const executor = EXECUTORS[skill.command];
    if (!executor) {
        return {
            answer: `No direct executor for skill: ${skill.command}`,
            toolsUsed: [],
            durationMs: Date.now() - startTime,
            inputTokens: 0,
            outputTokens: 0,
            error: `Missing executor: ${skill.command}`,
        };
    }

    try {
        // Resolve identity and create scoped clients
        const identity = await getIdentityProvider().resolve(userId);
        let awsClients;
        try {
            awsClients = await createClientsForIdentity(identity);
        } catch (err: any) {
            logger.warn({ err, role: identity.role, userId }, "STS AssumeRole failed, falling back to default clients");
        }

        // 1. Execute tools directly with scoped clients
        const toolResults = await executor(awsClients);

        const toolsUsed = toolResults.map((r) => ({
            tool: r.toolName,
            timestamp: new Date().toISOString(),
        }));

        // 2. Single Bedrock call to summarize
        const systemPrompt = buildSystemPrompt(userId);
        const { answer, inputTokens, outputTokens } = await summarizeToolResults(
            systemPrompt,
            skill.prompt,
            toolResults,
            model,
        );

        logger.info(
            { userId, skill: skill.command, durationMs: Date.now() - startTime, toolsUsed: toolsUsed.length, inputTokens, outputTokens },
            "Direct skill completed",
        );

        return {
            answer,
            toolsUsed,
            durationMs: Date.now() - startTime,
            inputTokens,
            outputTokens,
        };
    } catch (err: any) {
        logger.error({ err, skill: skill.command, userId }, "Direct skill execution failed");
        return {
            answer: `Erro na execucao direta: ${err.message}`,
            toolsUsed: [],
            durationMs: Date.now() - startTime,
            inputTokens: 0,
            outputTokens: 0,
            error: err.message,
        };
    }
}
