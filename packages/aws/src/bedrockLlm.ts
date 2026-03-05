// SPDX-License-Identifier: AGPL-3.0-only

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { logger } from "@agentrun-oss/core";
import type { LlmProvider, LlmResponse, ToolResultInput } from "@agentrun-oss/core";

export class BedrockLlmProvider implements LlmProvider {
    private client: BedrockRuntimeClient;

    constructor(region: string) {
        this.client = new BedrockRuntimeClient({ region });
    }

    async summarize(
        systemPrompt: string,
        userPrompt: string,
        toolResults: ToolResultInput[],
        model: string,
    ): Promise<LlmResponse> {
        const resultsBlock = toolResults
            .map((r) => `<tool name="${r.toolName}">\n${r.result}\n</tool>`)
            .join("\n\n");

        const userMessage = `${userPrompt}\n\n<tool-results>\n${resultsBlock}\n</tool-results>\n\nBased on the results above, generate the final summary.`;

        const body = JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        });

        logger.info({ model, toolResultsCount: toolResults.length }, "Bedrock summarize starting");

        const response = await this.client.send(
            new InvokeModelCommand({
                modelId: model,
                contentType: "application/json",
                accept: "application/json",
                body: new TextEncoder().encode(body),
            }),
        );

        const parsed = JSON.parse(new TextDecoder().decode(response.body));

        const answer = parsed.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("") ?? "";

        const inputTokens = parsed.usage?.input_tokens ?? 0;
        const outputTokens = parsed.usage?.output_tokens ?? 0;

        logger.info({ inputTokens, outputTokens }, "Bedrock summarize complete");

        return { answer, inputTokens, outputTokens };
    }
}
