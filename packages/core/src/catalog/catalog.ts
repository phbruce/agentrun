// SPDX-License-Identifier: AGPL-3.0-only
import type { ManifestCatalog, UseCaseDef, WorkflowDef, SkillDef, ToolDef, KnowledgeBaseDef } from "./types.js";
import { loadManifests } from "./loader.js";
import { loadCatalogForPacks } from "./packLoader.js";
import type { Role } from "../rbac/types.js";
import { PlatformRegistry } from "../platform/registry.js";

let _catalog: ManifestCatalog | null = null;

export function getCatalog(): ManifestCatalog {
    if (!_catalog) {
        _catalog = loadManifests();
    }
    return _catalog;
}

export function resetCatalog(): void {
    _catalog = null;
}

/** Populate the catalog singleton (e.g. from pack-loaded manifests). */
export function setCatalog(catalog: ManifestCatalog): void {
    _catalog = catalog;
}

export function getUseCasesForRole(role: Role): UseCaseDef[] {
    const { allowedUseCases } = getRoleUseCaseConfig(role);
    const catalog = getCatalog();

    // Wildcard: return all use cases
    if (allowedUseCases.includes("*")) {
        return [...catalog.useCases.values()];
    }

    return allowedUseCases
        .map((name) => catalog.useCases.get(name))
        .filter((uc): uc is UseCaseDef => uc !== undefined);
}

/** MCP server name used for Agent SDK tool prefix (mcp__{name}__). */
const MCP_SERVER_NAME = "infra-tools";

/** Tool types that are served via the MCP registry (core + declarative). */
const REGISTRY_TOOL_TYPES = new Set(["mcp-server", "aws-sdk", "http", "lambda"]);

export function getMcpToolsForRole(role: Role): string[] {
    const useCases = getUseCasesForRole(role);
    const catalog = getCatalog();
    const mcpTools = new Set<string>();

    for (const uc of useCases) {
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const toolName of wf.tools) {
                const tool = catalog.tools.get(toolName);
                if (tool && REGISTRY_TOOL_TYPES.has(tool.type)) {
                    // For mcp-server tools with mcpTool, use the prefixed name
                    if (tool.type === "mcp-server" && tool.mcpTool) {
                        mcpTools.add(tool.mcpTool);
                    }
                    // For all registry tool types, also add the tool name directly
                    mcpTools.add(tool.name);
                }
            }
            // Also include workflows-with-steps as callable MCP tools
            if (wf.steps && wf.steps.length > 0) {
                mcpTools.add(`mcp__${MCP_SERVER_NAME}__${wf.name}`);
            }
        }
    }

    return Array.from(mcpTools);
}

/** Get tool definitions reachable for a role via use-cases → workflows → tools. */
export function getToolDefsForRole(role: Role): ToolDef[] {
    const useCases = getUseCasesForRole(role);
    const catalog = getCatalog();
    const seen = new Set<string>();
    const result: ToolDef[] = [];

    for (const uc of useCases) {
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const toolName of wf.tools) {
                if (seen.has(toolName)) continue;
                seen.add(toolName);
                const tool = catalog.tools.get(toolName);
                if (tool && REGISTRY_TOOL_TYPES.has(tool.type)) {
                    result.push(tool);
                }
            }
        }
    }

    return result;
}

/** Get knowledge bases accessible for a role based on tag matching against use-case names/scopes. */
export function getKnowledgeBasesForRole(role: Role): KnowledgeBaseDef[] {
    const catalog = getCatalog();
    if (catalog.knowledgeBases.size === 0) return [];

    const useCases = getUseCasesForRole(role);
    const roleScopes = new Set<string>();
    for (const uc of useCases) {
        roleScopes.add(uc.name);
        if (uc.scope) roleScopes.add(uc.scope);
    }

    const result: KnowledgeBaseDef[] = [];
    for (const kb of catalog.knowledgeBases.values()) {
        // KB with no tags or wildcard tag → available to all roles
        if (kb.tags.length === 0 || kb.tags.includes("*")) {
            result.push(kb);
            continue;
        }
        // KB tags overlap with role's use-case names or scopes
        if (kb.tags.some(tag => roleScopes.has(tag))) {
            result.push(kb);
        }
    }

    return result;
}

/** Get tool definitions for a specific use case's workflows. */
export function getToolDefsForUseCase(useCaseName: string): ToolDef[] {
    const catalog = getCatalog();
    const uc = catalog.useCases.get(useCaseName);
    if (!uc) return [];

    const seen = new Set<string>();
    const result: ToolDef[] = [];

    for (const wfName of uc.workflows) {
        const wf = catalog.workflows.get(wfName);
        if (!wf) continue;
        for (const toolName of wf.tools) {
            if (seen.has(toolName)) continue;
            seen.add(toolName);
            const tool = catalog.tools.get(toolName);
            if (tool && REGISTRY_TOOL_TYPES.has(tool.type)) {
                result.push(tool);
            }
        }
    }

    return result;
}

export function getSkillToolsForRole(role: Role): { name: string; skillRef: string; description: string }[] {
    const useCases = getUseCasesForRole(role);
    const catalog = getCatalog();
    const seen = new Set<string>();
    const result: { name: string; skillRef: string; description: string }[] = [];

    for (const uc of useCases) {
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const toolName of wf.tools) {
                const tool = catalog.tools.get(toolName);
                if (tool && tool.type === "skill" && tool.skillRef && !seen.has(tool.name)) {
                    seen.add(tool.name);
                    result.push({ name: tool.name, skillRef: tool.skillRef, description: tool.description });
                }
            }
        }
    }

    return result;
}

export function getWorkflowsForUseCase(useCaseName: string): WorkflowDef[] {
    const catalog = getCatalog();
    const uc = catalog.useCases.get(useCaseName);
    if (!uc) return [];

    return uc.workflows
        .map((name) => catalog.workflows.get(name))
        .filter((wf): wf is WorkflowDef => wf !== undefined);
}

export interface UseCaseMatch {
    useCase: UseCaseDef | null;
    score: number;
    /** Confident when score >= 2 (multi-word match or multiple single keywords). */
    confident: boolean;
}

/** Score-based use-case matching with confidence. Used as fast-path for two-layer routing. */
export function matchUseCaseFromQuery(query: string, role: Role): UseCaseMatch {
    const useCases = getUseCasesForRole(role);
    const normalized = query.toLowerCase();

    let bestMatch: UseCaseDef | null = null;
    let bestScore = 0;

    for (const uc of useCases) {
        let score = 0;
        for (const keyword of uc.keywords) {
            if (normalized.includes(keyword.toLowerCase())) {
                score += keyword.includes(" ") ? 2 : 1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = uc;
        }
    }

    return { useCase: bestMatch, score: bestScore, confident: bestScore >= 2 };
}

/** Simple keyword-based use-case resolution (backward compat). */
export function resolveUseCaseFromQuery(query: string, role: Role): UseCaseDef | null {
    return matchUseCaseFromQuery(query, role).useCase;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export function getSkillByCommand(command: string): SkillDef | null {
    const catalog = getCatalog();
    for (const skill of catalog.skills.values()) {
        if (skill.command === command) {
            return skill;
        }
    }
    return null;
}

export function getSkillsForRole(role: Role): SkillDef[] {
    const catalog = getCatalog();
    const result: SkillDef[] = [];
    for (const skill of catalog.skills.values()) {
        if (skill.allowedRoles.includes(role)) {
            result.push(skill);
        }
    }
    return result;
}

export function resolveSkillMcpTools(skill: SkillDef): string[] {
    const catalog = getCatalog();
    const mcpTools: string[] = [];
    for (const toolName of skill.tools) {
        const tool = catalog.tools.get(toolName);
        if (tool && tool.type === "mcp-server" && tool.mcpTool) {
            mcpTools.push(tool.mcpTool);
        }
        // If the tool is referenced by a workflow-with-steps, include the workflow MCP name
        if (tool && tool.type === "lambda") {
            for (const wf of catalog.workflows.values()) {
                if (wf.steps && wf.steps.length > 0 && wf.tools.includes(toolName)) {
                    mcpTools.push(`mcp__${MCP_SERVER_NAME}__${wf.name}`);
                }
            }
        }
    }
    return mcpTools;
}

// ---------------------------------------------------------------------------
// Role → Use Cases mapping (imported lazily to avoid circular deps)
// ---------------------------------------------------------------------------

/** Config-driven role → use-cases mapping. Falls back to empty if no config loaded. */
function getRoleUseCases(): Record<string, string[]> {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const result: Record<string, string[]> = {};
            for (const [role, def] of Object.entries(registry.config.spec.roles)) {
                result[role] = def.useCases;
            }
            return result;
        }
    } catch { /* not configured yet */ }
    return {};
}

export function getRoleUseCaseConfig(role: Role): { allowedUseCases: string[] } {
    const mapping = getRoleUseCases();
    return { allowedUseCases: mapping[role] ?? [] };
}

// ---------------------------------------------------------------------------
// Pack-aware variants (async, for multi-pack contexts like MCP server)
// ---------------------------------------------------------------------------

/**
 * Load a merged catalog for the given packs. Returns all tools/workflows/
 * use-cases/skills from core + extension packs.
 */
export async function getCatalogForPacks(packs: string[]): Promise<ManifestCatalog> {
    return loadCatalogForPacks(packs);
}

/**
 * Get all MCP tool names available for a role across the given packs.
 * Returns mcpTool prefixed names (e.g., "mcp__infra-tools__list_lambdas")
 * used by the Agent SDK / Slack path.
 */
export async function getMcpToolsForRoleWithPacks(role: Role, packs: string[]): Promise<string[]> {
    const catalog = await getCatalogForPacks(packs);
    const mcpTools = new Set<string>();

    for (const toolName of collectToolNamesForRole(catalog, role)) {
        const tool = catalog.tools.get(toolName);
        if (tool && tool.type === "mcp-server" && tool.mcpTool) {
            mcpTools.add(tool.mcpTool);
        }
    }

    return Array.from(mcpTools);
}

/**
 * Get all MCP tool registry names available for a role across the given packs.
 * Returns tool metadata.name (e.g., "list_lambdas") which matches the
 * tool registry keys used by the MCP server.
 */
export async function getMcpToolNamesForRoleWithPacks(role: Role, packs: string[]): Promise<string[]> {
    const catalog = await getCatalogForPacks(packs);
    const toolNames = new Set<string>();

    for (const toolName of collectToolNamesForRole(catalog, role)) {
        const tool = catalog.tools.get(toolName);
        if (tool && REGISTRY_TOOL_TYPES.has(tool.type)) {
            toolNames.add(tool.name);
        }
    }

    // Include workflows-with-steps as callable tools
    collectWorkflowToolNames(catalog, role, toolNames);

    return Array.from(toolNames);
}

// ---------------------------------------------------------------------------
// Scope-based filtering (for MCP server ?scope= query parameter)
// ---------------------------------------------------------------------------

/**
 * Build scope → use-case mapping from the catalog.
 * Use-cases declare their scope via `spec.scope` in the YAML manifest.
 * This replaces the previous hardcoded SCOPE_USE_CASES map.
 */
function buildScopeMap(catalog: ManifestCatalog): Record<string, string[]> {
    const scopeMap: Record<string, string[]> = {};
    for (const uc of catalog.useCases.values()) {
        if (uc.scope) {
            if (!scopeMap[uc.scope]) scopeMap[uc.scope] = [];
            scopeMap[uc.scope].push(uc.name);
        }
    }
    return scopeMap;
}

/**
 * Get MCP tool registry names filtered by scope (use-case grouping).
 * Used by the MCP server when `?scope=aws|github|jira` is passed.
 * Scopes are derived from `spec.scope` in use-case manifests.
 * Falls back to full role-based filtering if scope is unknown.
 */
export async function getMcpToolNamesForScope(
    role: Role, packs: string[], scope: string,
): Promise<string[]> {
    const catalog = await getCatalogForPacks(packs);
    const scopeMap = buildScopeMap(catalog);
    const scopeUseCases = scopeMap[scope];

    if (!scopeUseCases) {
        // Unknown scope: fall back to full role-based filtering
        return getMcpToolNamesForRoleWithPacks(role, packs);
    }

    const { allowedUseCases } = getRoleUseCaseConfig(role);

    // Intersect: only use-cases in BOTH the scope AND the role
    const filtered = scopeUseCases.filter(uc => allowedUseCases.includes(uc));

    const toolNames = new Set<string>();
    for (const ucName of filtered) {
        const uc = catalog.useCases.get(ucName);
        if (!uc) continue;
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const t of wf.tools) {
                const tool = catalog.tools.get(t);
                if (tool && REGISTRY_TOOL_TYPES.has(tool.type)) toolNames.add(tool.name);
            }
        }
    }

    // Include workflows-with-steps as callable tools
    collectWorkflowToolNames(catalog, role, toolNames);

    return Array.from(toolNames);
}

/** Collect workflow names that have steps (executable workflows → MCP tools). */
function collectWorkflowToolNames(catalog: ManifestCatalog, role: Role, toolNames: Set<string>): void {
    const { allowedUseCases } = getRoleUseCaseConfig(role);

    for (const uc of catalog.useCases.values()) {
        // Include if role has access OR it's a pack extension use-case
        if (!allowedUseCases.includes(uc.name) && !catalog.useCases.has(uc.name)) continue;
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (wf?.steps && wf.steps.length > 0) {
                toolNames.add(wf.name);
            }
        }
    }
}

/** Collect all tool names reachable for a role from use-cases + extension packs. */
function collectToolNamesForRole(catalog: ManifestCatalog, role: Role): Set<string> {
    const { allowedUseCases } = getRoleUseCaseConfig(role);
    const toolNames = new Set<string>();

    // From role-mapped use cases
    for (const ucName of allowedUseCases) {
        const uc = catalog.useCases.get(ucName);
        if (!uc) continue;
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const t of wf.tools) toolNames.add(t);
        }
    }

    // From extension pack use-cases (implicitly allowed if user has the pack)
    for (const uc of catalog.useCases.values()) {
        if (allowedUseCases.includes(uc.name)) continue;
        for (const wfName of uc.workflows) {
            const wf = catalog.workflows.get(wfName);
            if (!wf) continue;
            for (const t of wf.tools) toolNames.add(t);
        }
    }

    return toolNames;
}

/**
 * Get all skills available for a role across the given packs.
 */
export async function getSkillsForRoleWithPacks(role: Role, packs: string[]): Promise<SkillDef[]> {
    const catalog = await getCatalogForPacks(packs);
    const result: SkillDef[] = [];
    for (const skill of catalog.skills.values()) {
        if (skill.allowedRoles.includes(role)) {
            result.push(skill);
        }
    }
    return result;
}

/**
 * Find a skill by command across the given packs.
 */
export async function getSkillByCommandWithPacks(command: string, packs: string[]): Promise<SkillDef | null> {
    const catalog = await getCatalogForPacks(packs);
    for (const skill of catalog.skills.values()) {
        if (skill.command === command) {
            return skill;
        }
    }
    return null;
}
