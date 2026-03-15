// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";
import type { LlmProvider, LlmResponse, ToolResultInput } from "@agentrun-ai/core";

/**
 * Vertex AI LLM provider for Claude models on Google Cloud.
 *
 * Uses the @google-cloud/vertexai SDK to invoke Claude via Vertex AI.
 *
 * @param projectId - GCP project ID
 * @param location  - GCP region (e.g. "us-east5")
 * @param model     - Claude model identifier (default: claude-sonnet-4-20250514)
 */
export class VertexAiLlmProvider implements LlmProvider {
    private vertexai: any = null;
    private generativeModel: any = null;

    constructor(
        private readonly projectId: string,
        private readonly location: string,
        private readonly defaultModel: string = "claude-sonnet-4-20250514",
    ) {}

    private async ensureClient(model: string): Promise<any> {
        if (this.generativeModel && model === this.defaultModel) return this.generativeModel;

        const { VertexAI } = await import("@google-cloud/vertexai");
        this.vertexai = new VertexAI({ project: this.projectId, location: this.location });
        this.generativeModel = this.vertexai.getGenerativeModel({ model });
        return this.generativeModel;
    }

    async summarize(
        systemPrompt: string,
        userPrompt: string,
        toolResults: ToolResultInput[],
        model: string,
    ): Promise<LlmResponse> {
        const generativeModel = await this.ensureClient(model);

        const resultsBlock = toolResults
            .map((r) => `<tool name="${r.toolName}">\n${r.result}\n</tool>`)
            .join("\n\n");

        const userMessage = `${userPrompt}\n\n<tool-results>\n${resultsBlock}\n</tool-results>\n\nBased on the results above, generate the final summary.`;

        logger.info({ model, toolResultsCount: toolResults.length }, "Vertex AI summarize starting");

        const request = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: { maxOutputTokens: 4096 },
        };

        const response = await generativeModel.generateContent(request);
        const candidate = response.response?.candidates?.[0];

        const answer = candidate?.content?.parts
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("") ?? "";

        const usageMetadata = response.response?.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

        logger.info({ inputTokens, outputTokens }, "Vertex AI summarize complete");

        return { answer, inputTokens, outputTokens };
    }
}
