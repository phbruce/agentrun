import { selectModel, classifyComplexity } from "@agentrun-ai/core";

/**
 * Model Router Demo
 *
 * Demonstrates how AgentRun's model router selects optimal models based on:
 *   1. Query complexity (zero-cost heuristics)
 *   2. Role-based allowed models (RBAC filtering)
 *   3. Cost optimization (cheapest model meeting capability requirement)
 */

// Define available models with capabilities and costs
const models = {
    "gemini-1.5-flash": {
        provider: "vertex-ai",
        modelId: "gemini-1.5-flash",
        capability: "fast" as const,
        inputCostPer1kTokens: 0.00075,
        outputCostPer1kTokens: 0.003,
        maxOutputTokens: 4096,
    },
    "gemini-2.0-pro": {
        provider: "vertex-ai",
        modelId: "gemini-2.0-pro",
        capability: "advanced" as const,
        inputCostPer1kTokens: 0.01,
        outputCostPer1kTokens: 0.03,
        maxOutputTokens: 8192,
    },
    "gpt-4o": {
        provider: "openai",
        modelId: "gpt-4o",
        capability: "advanced" as const,
        inputCostPer1kTokens: 0.015,
        outputCostPer1kTokens: 0.06,
        maxOutputTokens: 4096,
    },
};

// Test queries with expected complexity
const testQueries = [
    {
        query: "list all services",
        expectedComplexity: "simple" as const,
    },
    {
        query: "show me the current deployment status",
        expectedComplexity: "simple" as const,
    },
    {
        query: "analyze the performance bottleneck in our database queries",
        expectedComplexity: "complex" as const,
    },
    {
        query: "design a migration strategy for our microservices architecture",
        expectedComplexity: "complex" as const,
    },
    {
        query: "compare the trade-offs between moving to serverless vs containers",
        expectedComplexity: "complex" as const,
    },
    {
        query: "what is the status of my pull requests",
        expectedComplexity: "simple" as const,
    },
];

// Example roles with different model access
const roles = {
    engineer: ["gemini-1.5-flash", "gemini-2.0-pro", "gpt-4o"],
    analyst: ["gemini-1.5-flash"],
    executive: ["gemini-2.0-pro"],
};

console.log("🚀 AgentRun Model Router Demo\n");
console.log("=".repeat(70));

// Test complexity classification
console.log("\n📊 Query Complexity Classification:\n");
for (const { query, expectedComplexity } of testQueries) {
    const complexity = classifyComplexity(query);
    const match = complexity === expectedComplexity ? "✅" : "❌";
    console.log(
        `${match} "${query}"\n   → ${complexity} (expected: ${expectedComplexity})\n`
    );
}

// Test model selection with RBAC
console.log("=".repeat(70));
console.log("\n🎯 Model Selection (with RBAC):\n");

const complexQueries = [
    "list services",
    "analyze performance bottlenecks",
    "design migration strategy",
];

for (const query of complexQueries) {
    console.log(`Query: "${query}"`);

    // Engineer role (all models available)
    const engineerSelection = selectModel(query, models, roles.engineer);
    console.log(`  Engineer:   ${engineerSelection.name}`);
    console.log(`    Reason:    ${engineerSelection.reason}`);
    console.log(`    Cost:      $${engineerSelection.model.inputCostPer1kTokens}/1K tokens input`);

    // Analyst role (only fast models)
    const analystSelection = selectModel(query, models, roles.analyst);
    console.log(`  Analyst:    ${analystSelection.name}`);
    console.log(`    Reason:    ${analystSelection.reason}\n`);
}

console.log("=".repeat(70));
console.log("\n💡 Key Insights:\n");
console.log("1. Simple queries (list, show, facts) use fast/cheap models");
console.log("2. Complex queries (analyze, design, compare) use advanced models");
console.log("3. Roles restrict which models are available (RBAC constraint)");
console.log("4. Router always picks the cheapest model meeting complexity requirement");
console.log("5. If no model meets requirement, falls back to most capable available\n");
