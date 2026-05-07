// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @agentrun-ai/executor-http — HTTP executor.
 *
 * Resolves user authentication from `ExecutionContext.userTokenStore` only —
 * no global fallback. Throws `MissingUserTokenError` when no token is present
 * and `auth.type` is set; channels translate the error to a connect prompt.
 */

import type {
    Executor,
    ExecutionContext,
    ToolDef,
    ToolResult,
} from "@agentrun-ai/core";
import { MissingUserTokenError } from "@agentrun-ai/core";
import { resolvePathTemplate } from "./pathTemplate.js";

export interface HttpExecutorConfig {
    /** Provider name passed to UserTokenStore for tools that require auth. */
    defaultProvider?: string;
    /** Override the global fetch (testing). */
    fetch?: typeof fetch;
}

export class HttpExecutor implements Executor {
    readonly type = "http";

    constructor(private readonly config: HttpExecutorConfig = {}) {}

    async execute(
        tool: ToolDef,
        args: Record<string, unknown>,
        ctx: ExecutionContext,
    ): Promise<ToolResult> {
        if (!tool.http) {
            return errorResult(`Tool '${tool.name}' has no http config`);
        }
        const { baseUrl, method, path } = tool.http;
        if (!baseUrl || !method || !path) {
            return errorResult(`Tool '${tool.name}' has incomplete http config`);
        }

        const url = baseUrl.replace(/\/$/, "") + resolvePathTemplate(path, args);
        const headers: Record<string, string> = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(tool.http.headers ?? {}),
        };

        const authType = tool.http.auth?.type;
        if (authType) {
            const provider = tool.category ?? this.config.defaultProvider;
            if (!provider) {
                return errorResult(`Cannot resolve auth provider for tool '${tool.name}'`);
            }
            const token = await ctx.userTokenStore.getToken(ctx.userId, provider);
            if (!token) {
                throw new MissingUserTokenError(provider);
            }
            headers.Authorization =
                authType === "basic"
                    ? `Basic ${Buffer.from(token.accessToken).toString("base64")}`
                    : `Bearer ${token.accessToken}`;
        }

        let body: string | undefined;
        if (method !== "GET" && method !== "DELETE") {
            body = JSON.stringify(args);
        }

        const fetchImpl = this.config.fetch ?? fetch;
        const res = await fetchImpl(url, { method, headers, body });
        const text = await res.text();

        if (!res.ok) {
            return errorResult(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        }

        let parsed: unknown = text;
        try {
            parsed = JSON.parse(text);
        } catch {
            // keep as text
        }

        return {
            content: [
                {
                    type: "json",
                    data: { status: res.status, url, response: parsed },
                },
            ],
        };
    }
}

function errorResult(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Plugin entry point. The Platform calls this at boot.
 */
export default async function register(
    platform: { registerExecutor(e: Executor): void; logger: { info: (m: string) => void } },
    config?: unknown,
): Promise<void> {
    const cfg = (config as HttpExecutorConfig | undefined) ?? {};
    platform.registerExecutor(new HttpExecutor(cfg));
    platform.logger.info("[@agentrun-ai/executor-http] registered");
}
