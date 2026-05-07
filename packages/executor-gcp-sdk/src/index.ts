// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @agentrun-ai/executor-gcp-sdk — GCP SDK executor.
 *
 * Dispatches an operation key (e.g. `discoveryengine.search`,
 * `bigquery.query`) to a registered handler. Handlers are pluggable so
 * different GCP SDKs can be wired in without touching the core executor.
 *
 * Built-in:
 *   - `discoveryengine.search` — Vertex AI Discovery Engine semantic search.
 */

import type {
    Executor,
    ExecutionContext,
    ToolDef,
    ToolResult,
} from "@agentrun-ai/core";

export type GcpOperationHandler = (
    tool: ToolDef,
    args: Record<string, unknown>,
    ctx: ExecutionContext,
) => Promise<unknown>;

export interface GcpSdkExecutorConfig {
    projectId?: string;
    location?: string;
    dataStore?: string;
    handlers?: Record<string, GcpOperationHandler>;
    fetch?: typeof fetch;
    accessToken?: () => Promise<string>;
}

export class GcpSdkExecutor implements Executor {
    readonly type = "gcp-sdk";
    private readonly handlers: Record<string, GcpOperationHandler>;

    constructor(private readonly config: GcpSdkExecutorConfig = {}) {
        this.handlers = {
            "discoveryengine.search": this.discoveryEngineSearch.bind(this),
            ...(config.handlers ?? {}),
        };
    }

    async execute(
        tool: ToolDef,
        args: Record<string, unknown>,
        ctx: ExecutionContext,
    ): Promise<ToolResult> {
        const operation = tool.gcpSdk?.operation;
        if (!operation) {
            return errorResult(`Tool '${tool.name}' missing gcpSdk.operation`);
        }
        const handler = this.handlers[operation];
        if (!handler) {
            return errorResult(`No GCP SDK handler registered for operation '${operation}'`);
        }
        try {
            const data = await handler(tool, args, ctx);
            return { content: [{ type: "json", data }] };
        } catch (err) {
            const e = err as Error;
            ctx.logger.error(`[gcp-sdk] '${operation}' failed: ${e.message}`);
            return errorResult(`GCP SDK operation '${operation}' failed: ${e.message}`);
        }
    }

    private async discoveryEngineSearch(
        tool: ToolDef,
        args: Record<string, unknown>,
        _ctx: ExecutionContext,
    ): Promise<unknown> {
        const projectId = this.config.projectId ?? process.env.GCP_PROJECT_ID ?? "";
        const location = this.config.location ?? process.env.GCP_LOCATION ?? "global";
        const dataStore =
            (tool.gcpSdk?.dataStore as string | undefined) ??
            this.config.dataStore ??
            process.env.KNOWLEDGE_DATA_STORE ??
            "";
        if (!projectId || !dataStore) {
            throw new Error(
                `discoveryengine.search requires projectId and dataStore (got project='${projectId}', dataStore='${dataStore}')`,
            );
        }
        const query = String(args.query ?? "");
        if (!query) throw new Error("query argument is required");
        const topK = Number(args.topK ?? 5);

        const url = `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/${location}/collections/default_collection/dataStores/${dataStore}/servingConfigs/default_search:search`;

        const token = await this.getAccessToken();
        const fetchImpl = this.config.fetch ?? fetch;
        const res = await fetchImpl(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, pageSize: topK }),
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Discovery Engine HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        const parsed = JSON.parse(text) as {
            results?: Array<{
                document?: {
                    derivedStructData?: { snippets?: Array<{ snippet?: string }> };
                    structData?: unknown;
                    id?: string;
                };
            }>;
        };
        const chunks = (parsed.results ?? []).map((r) => ({
            id: r.document?.id,
            snippets: r.document?.derivedStructData?.snippets?.map((s) => s.snippet) ?? [],
            metadata: r.document?.structData,
        }));
        return { dataStore, query, topK, results: chunks };
    }

    private async getAccessToken(): Promise<string> {
        if (this.config.accessToken) return await this.config.accessToken();
        const { GoogleAuth } = await import("google-auth-library");
        const auth = new GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        const client = await auth.getClient();
        const { token } = await client.getAccessToken();
        if (!token) throw new Error("failed to obtain GCP access token");
        return token;
    }
}

function errorResult(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

export default async function register(
    platform: { registerExecutor(e: Executor): void; logger: { info: (m: string) => void } },
    config?: unknown,
): Promise<void> {
    platform.registerExecutor(
        new GcpSdkExecutor((config as GcpSdkExecutorConfig | undefined) ?? {}),
    );
    platform.logger.info("[@agentrun-ai/executor-gcp-sdk] registered");
}
