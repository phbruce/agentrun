// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenAI-Compatible LLM Caller
 *
 * Generic caller that works with any OpenAI-compatible API endpoint
 * (OpenAI, self-hosted gateways, local LLM servers, etc.)
 *
 * This is model-agnostic and provider-agnostic. It implements the
 * callLlm interface expected by GenericAgentConfig.
 */

import { logger } from "../logger.js";
import type { FunctionDeclaration, FunctionCall } from "./genericRunner.js";

export interface OpenAICallerConfig {
    /** Base URL of the OpenAI-compatible API (e.g. "https://api.openai.com" or a self-hosted gateway) */
    baseUrl: string;
    /** Default model ID if not provided by the router */
    defaultModel: string;
    /** Function to resolve the auth token. Receives userId for per-user token resolution. */
    resolveToken: (userId?: string) => Promise<string>;
    /** Request timeout in ms (default: 60000) */
    timeoutMs?: number;
}

interface OpenAIMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
}

interface OpenAITool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/**
 * Create a callLlm function that uses an OpenAI-compatible API.
 */
export function createOpenAICaller(config: OpenAICallerConfig) {
    const { baseUrl, defaultModel, resolveToken, timeoutMs = 60000 } = config;
    const endpoint = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

    return async (options: {
        systemPrompt: string;
        contents: Array<{ role: string; parts: unknown[] }>;
        tools: FunctionDeclaration[];
        modelId?: string;
        userId?: string;
    }): Promise<{
        text?: string;
        functionCalls?: FunctionCall[];
        inputTokens?: number;
        outputTokens?: number;
    }> => {
        const model = options.modelId || defaultModel;
        const token = await resolveToken(options.userId);

        // Convert agentrun format → OpenAI messages
        const messages: OpenAIMessage[] = [
            { role: "system", content: options.systemPrompt },
        ];

        for (const entry of options.contents) {
            if (entry.role === "user") {
                // User messages: text parts or function responses
                const textParts: string[] = [];
                const toolResponses: OpenAIMessage[] = [];

                for (const part of entry.parts as any[]) {
                    if (part.text) {
                        textParts.push(part.text);
                    } else if (part.functionResponse) {
                        toolResponses.push({
                            role: "tool",
                            content: JSON.stringify(part.functionResponse.response),
                            tool_call_id: part.functionResponse.name,
                        });
                    }
                }

                if (textParts.length > 0) {
                    messages.push({ role: "user", content: textParts.join("\n") });
                }
                for (const tr of toolResponses) {
                    messages.push(tr);
                }
            } else if (entry.role === "model") {
                // Model messages: text or function calls
                const textParts: string[] = [];
                const toolCalls: OpenAIMessage["tool_calls"] = [];

                for (const part of entry.parts as any[]) {
                    if (part.text) {
                        textParts.push(part.text);
                    } else if (part.functionCall) {
                        toolCalls.push({
                            id: part.functionCall.name,
                            type: "function",
                            function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args || {}),
                            },
                        });
                    }
                }

                const msg: OpenAIMessage = { role: "assistant" };
                if (textParts.length > 0) msg.content = textParts.join("\n");
                if (toolCalls.length > 0) msg.tool_calls = toolCalls;
                messages.push(msg);
            }
        }

        // Convert agentrun tool declarations → OpenAI tools
        const tools: OpenAITool[] = options.tools.map(t => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters || { type: "object", properties: {} },
            },
        }));

        const body: Record<string, unknown> = {
            model,
            messages,
        };

        if (tools.length > 0) {
            body.tools = tools;
        }

        logger.info({ model, endpoint: baseUrl, messageCount: messages.length, toolCount: tools.length }, "OpenAI-compatible LLM call");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!res.ok) {
                const errBody = await res.text();
                logger.error({ status: res.status, body: errBody.slice(0, 500), model }, "OpenAI API error");
                throw new Error(`GenAI Gateway error ${res.status}: ${errBody.slice(0, 200)}`);
            }

            const data = await res.json() as {
                choices?: Array<{
                    message?: {
                        content?: string;
                        tool_calls?: Array<{
                            id: string;
                            function: { name: string; arguments: string };
                        }>;
                    };
                }>;
                usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                };
            };

            const choice = data.choices?.[0];
            const text = choice?.message?.content || undefined;

            const functionCalls: FunctionCall[] = (choice?.message?.tool_calls || []).map(tc => ({
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments || "{}"),
            }));

            return {
                text,
                functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
                inputTokens: data.usage?.prompt_tokens || 0,
                outputTokens: data.usage?.completion_tokens || 0,
            };
        } finally {
            clearTimeout(timeout);
        }
    };
}
