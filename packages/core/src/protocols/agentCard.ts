// SPDX-License-Identifier: AGPL-3.0-only
import type { PlatformConfig } from "../platform/types.js";
import type { ManifestCatalog } from "../catalog/types.js";
import type { AgentCard, AgentSkillCard } from "./types.js";

/**
 * Build an A2A-compatible Agent Card from platform config and catalog.
 * The Agent Card enables automatic discovery by other agents or platforms.
 */
export function buildAgentCard(config: PlatformConfig, catalog: ManifestCatalog): AgentCard {
    const env = config.spec.environment;

    // Map catalog skills to Agent Card skill entries
    const skills: AgentSkillCard[] = [];
    for (const [name, skill] of catalog.skills) {
        skills.push({
            id: name,
            name: skill.command,
            description: skill.description,
            tags: skill.tools,
            examples: [`/${skill.command}`],
        });
    }

    // Determine authentication type from config
    const authType = config.spec.protocols?.mcp?.auth ?? "bearer-token";

    return {
        name: config.metadata.name ?? "AgentRun",
        description: `AI agent runtime for ${env.name}`,
        url: config.spec.protocols?.mcp?.transport === "streamable-http"
            ? `https://api.${env.name.toLowerCase().replace(/\s+/g, "")}/agentrun/mcp`
            : process.env.AGENTRUN_MCP_URL ?? "http://localhost:3000/agentrun/mcp",
        capabilities: ["tools", "workflows", "skills"],
        authentication: { type: authType },
        version: config.spec.protocols?.a2a?.version ?? "1.0.0",
        skills,
    };
}
