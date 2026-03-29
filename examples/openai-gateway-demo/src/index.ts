import { createOpenAICaller } from "@agentrun-ai/core";

/**
 * OpenAI-Compatible Gateway Demo
 *
 * Demonstrates how to use AgentRun with any OpenAI-compatible LLM endpoint:
 *   - OpenAI API
 *   - Self-hosted gateways
 *   - Local LLM servers (Ollama, vLLM, LM Studio)
 *   - Anthropic Vertex AI Gateway
 *
 * This example shows basic caller setup and usage.
 */

// Example 1: Using Ollama locally
console.log("🚀 AgentRun OpenAI-Compatible Gateway Demo\n");
console.log("=".repeat(70));

const createOllamaCaller = () => {
    return createOpenAICaller({
        baseUrl: "http://localhost:11434", // Ollama default port
        defaultModel: "mistral",
        resolveToken: async () => "not-used", // Ollama doesn't require auth
        timeoutMs: 120000, // Longer timeout for local inference
    });
};

// Example 2: Using OpenAI API
const createOpenAICaller_Example = () => {
    return createOpenAICaller({
        baseUrl: "https://api.openai.com",
        defaultModel: "gpt-4o",
        resolveToken: async (userId) => {
            // In production, fetch from your token store
            return process.env.OPENAI_API_KEY || "";
        },
        timeoutMs: 60000,
    });
};

// Example 3: Using self-hosted gateway
const createGatewayCaller = () => {
    return createOpenAICaller({
        baseUrl: "https://llm-gateway.internal.example.com",
        defaultModel: "claude-3-opus",
        resolveToken: async (userId) => {
            // Resolve per-user token from your token store
            // const user = await db.user.findUnique({ where: { id: userId } });
            // return user.llmGatewayToken;
            return "user-token-here";
        },
        timeoutMs: 90000,
    });
};

// Example usage pattern
console.log("\n📋 Caller Configuration Examples:\n");

console.log("1. Local Ollama:");
console.log("   baseUrl: http://localhost:11434");
console.log("   defaultModel: mistral | neural-chat | llama2");
console.log("   Works with: docker run -p 11434:11434 ollama/ollama\n");

console.log("2. OpenAI API:");
console.log("   baseUrl: https://api.openai.com");
console.log("   defaultModel: gpt-4o | gpt-4-turbo | gpt-3.5-turbo");
console.log("   Requires: OPENAI_API_KEY environment variable\n");

console.log("3. Vertex AI Gateway:");
console.log("   baseUrl: https://REGION-aiplatform.googleapis.com/v1/...");
console.log("   defaultModel: gemini-2.0-pro | gemini-1.5-flash");
console.log("   Uses: Google OAuth2 bearer token\n");

console.log("4. Self-Hosted Gateway (vLLM, LM Studio, etc.):");
console.log("   baseUrl: https://your-gateway.example.com");
console.log("   defaultModel: any model served by gateway");
console.log("   Per-user token resolution for multi-tenant access\n");

console.log("=".repeat(70));
console.log("\n🔧 Integration with GenericAgentConfig:\n");

const exampleIntegration = `
import { processGenericQuery } from "@agentrun-ai/core";
import { createOpenAICaller } from "@agentrun-ai/core";

const openaiCaller = createOpenAICaller({
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
    resolveToken: async (userId) => await tokenStore.get(userId, "openai"),
});

const result = await processGenericQuery(
    "show cluster status",
    "U12345",
    "slack",
    {
        callLlm: openaiCaller,
        executeTool: myToolExecutor,
        models: {
            fast: { ... },
            advanced: { ... },
        },
    }
);

console.log(result.text);
// → "Your cluster has 12 nodes. 2 are in warning state. ..."
`;

console.log(exampleIntegration);

console.log("=".repeat(70));
console.log("\n✨ Key Features:\n");
console.log("- Works with ANY OpenAI-compatible endpoint");
console.log("- Per-user token resolution for multi-tenant access");
console.log("- Automatic message format conversion (agentrun ↔ OpenAI)");
console.log("- Token counting for cost tracking");
console.log("- Timeout and error handling built-in");
console.log("- Pluggable into GenericAgentConfig");
console.log("- Model-agnostic: same code works with any model\n");
