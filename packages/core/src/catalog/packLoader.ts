// SPDX-License-Identifier: AGPL-3.0-only
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { logger } from "../logger.js";
import { loadManifests } from "./loader.js";
import type { ManifestCatalog, ToolDef, WorkflowDef, UseCaseDef, SkillDef, KnowledgeBaseDef } from "./types.js";
import {
    PackManifestSchema,
    RemoteToolSchema,
    RemoteWorkflowSchema,
    RemoteUseCaseSchema,
    RemoteSkillSchema,
    RemoteKnowledgeBaseSchema,
} from "./packTypes.js";
import type { PackDef } from "./packTypes.js";
import { ensurePlatform } from "../platform/bootstrap.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
    catalog: ManifestCatalog;
    pack: PackDef;
    expiresAt: number;
}

const packCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Core bundle (sync, always available)
// ---------------------------------------------------------------------------

let _coreCatalog: ManifestCatalog | null = null;
const CORE_PACK: PackDef = {
    name: "core",
    version: "1.0.0",
    description: "Core infrastructure tools",
    inherits: [],
    allowedRoles: ["executive", "tech_lead", "developer", "platform", "viewer"],
    secrets: [],
};

function getCoreCatalog(): ManifestCatalog {
    if (!_coreCatalog) {
        _coreCatalog = loadManifests();
    }
    return _coreCatalog;
}

// ---------------------------------------------------------------------------
// Local pack loader (filesystem override for dev/testing)
// ---------------------------------------------------------------------------

function listYamlFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const child of fs.readdirSync(full)) {
                if (child.endsWith(".yaml") || child.endsWith(".yml")) {
                    results.push(path.join(entry.name, child));
                }
            }
        } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
            results.push(entry.name);
        }
    }
    return results;
}

function fetchLocalPack(packName: string, localDir: string): { pack: PackDef; catalog: ManifestCatalog } | null {
    const packDir = path.join(localDir, packName);
    const resolvedDir = fs.existsSync(packDir) ? packDir : localDir;

    if (!fs.existsSync(resolvedDir)) {
        logger.warn({ packName, dir: resolvedDir }, "Local pack directory not found");
        return null;
    }

    logger.warn({ packName, dir: resolvedDir }, "Loading pack from LOCAL filesystem (dev mode)");

    const fileContents = new Map<string, string>();
    const yamlFiles = listYamlFiles(resolvedDir);
    for (const relPath of yamlFiles) {
        const content = fs.readFileSync(path.join(resolvedDir, relPath), "utf-8");
        fileContents.set(relPath, content);
    }

    if (fileContents.size === 0) {
        logger.warn({ packName }, "Local pack directory is empty");
        return null;
    }

    return parsePackContents(packName, fileContents);
}

// ---------------------------------------------------------------------------
// Shared pack content parser (used by both local and remote loaders)
// ---------------------------------------------------------------------------

function parsePackContents(packName: string, fileContents: Map<string, string>): { pack: PackDef; catalog: ManifestCatalog } {
    const packYaml = fileContents.get("pack.yaml") ?? fileContents.get("pack.yml");
    let pack: PackDef;

    if (packYaml) {
        const parsed = PackManifestSchema.parse(yaml.load(packYaml));
        pack = {
            name: parsed.metadata.name,
            version: parsed.metadata.version,
            description: parsed.spec.description,
            inherits: parsed.spec.inherits,
            allowedRoles: parsed.spec.allowedRoles,
            secrets: parsed.spec.secrets,
        };
    } else {
        pack = {
            name: packName,
            version: "0.0.0",
            description: `Pack: ${packName}`,
            inherits: ["core"],
            allowedRoles: ["platform", "tech_lead"],
            secrets: [],
        };
    }

    const tools = new Map<string, ToolDef>();
    const workflows = new Map<string, WorkflowDef>();
    const useCases = new Map<string, UseCaseDef>();
    const skills = new Map<string, SkillDef>();
    const knowledgeBases = new Map<string, KnowledgeBaseDef>();

    for (const [filePath, content] of fileContents) {
        if (filePath === "pack.yaml" || filePath === "pack.yml") continue;

        try {
            const doc = yaml.load(content) as any;
            if (!doc?.kind) continue;

            const dir = filePath.split("/")[0];

            if (dir === "tools" || doc.kind === "Tool") {
                const parsed = RemoteToolSchema.parse(doc);
                tools.set(parsed.metadata.name, {
                    name: parsed.metadata.name,
                    type: parsed.spec.type,
                    mcpTool: parsed.spec.mcpTool,
                    skillRef: parsed.spec.skillRef,
                    description: parsed.spec.description,
                    category: parsed.spec.category,
                    awsSdk: parsed.spec.awsSdk,
                    http: parsed.spec.http,
                    lambda: parsed.spec.lambda,
                    secrets: parsed.spec.secrets,
                });
            } else if (dir === "workflows" || doc.kind === "Workflow") {
                const parsed = RemoteWorkflowSchema.parse(doc);
                workflows.set(parsed.metadata.name, {
                    name: parsed.metadata.name,
                    description: parsed.spec.description,
                    tools: parsed.spec.tools,
                    steps: parsed.spec.steps,
                    inputSchema: parsed.spec.inputSchema,
                });
            } else if (dir === "use-cases" || doc.kind === "UseCase") {
                const parsed = RemoteUseCaseSchema.parse(doc);
                useCases.set(parsed.metadata.name, {
                    name: parsed.metadata.name,
                    description: parsed.spec.description,
                    keywords: parsed.spec.keywords,
                    workflows: parsed.spec.workflows,
                    template: parsed.spec.template,
                });
            } else if (dir === "skills" || doc.kind === "Skill") {
                const parsed = RemoteSkillSchema.parse(doc);
                skills.set(parsed.metadata.name, {
                    name: parsed.metadata.name,
                    command: parsed.spec.command,
                    description: parsed.spec.description,
                    prompt: parsed.spec.prompt,
                    tools: parsed.spec.tools,
                    allowedRoles: parsed.spec.allowedRoles,
                    maxTurns: parsed.spec.maxTurns,
                    maxBudgetUsd: parsed.spec.maxBudgetUsd,
                    args: parsed.spec.args,
                    mode: parsed.spec.mode,
                });
            } else if (dir === "knowledge-bases" || doc.kind === "KnowledgeBase") {
                const parsed = RemoteKnowledgeBaseSchema.parse(doc);
                knowledgeBases.set(parsed.metadata.name, {
                    name: parsed.metadata.name,
                    description: parsed.spec.description,
                    source: parsed.spec.source,
                    chunking: parsed.spec.chunking,
                    embedding: parsed.spec.embedding,
                    tags: parsed.spec.tags,
                });
            }
        } catch (err: any) {
            logger.warn({ packName, file: filePath, error: err.message }, "Failed to parse manifest in pack");
        }
    }

    return { pack, catalog: { tools, workflows, useCases, skills, knowledgeBases } };
}

// ---------------------------------------------------------------------------
// Remote pack loader (via ManifestStore)
// ---------------------------------------------------------------------------

async function fetchRemotePack(packName: string): Promise<{ pack: PackDef; catalog: ManifestCatalog } | null> {
    const prefix = `packs/${packName}/`;

    try {
        const registry = ensurePlatform();
        const store = registry.manifests;

        // List all YAML files in the pack directory
        const files = await store.listFiles(prefix);
        if (files.length === 0) {
            logger.warn({ packName }, "Pack not found in manifest store");
            return null;
        }

        // Fetch all YAML files in parallel
        const fileContents = new Map<string, string>();
        await Promise.all(
            files.map(async (key) => {
                const content = await store.getFile(key);
                if (content) {
                    const relativePath = key.slice(prefix.length);
                    fileContents.set(relativePath, content);
                }
            }),
        );

        return parsePackContents(packName, fileContents);
    } catch (err: any) {
        logger.error({ packName, error: err.message }, "Failed to fetch pack from manifest store");
        return null;
    }
}

async function getRemotePack(packName: string): Promise<CacheEntry | null> {
    const cached = packCache.get(packName);
    if (cached && cached.expiresAt > Date.now()) {
        return cached;
    }

    // Local override: load from filesystem if AGENTRUN_LOCAL_PACK is set
    const localDir = process.env.AGENTRUN_LOCAL_PACK;
    let result: { pack: PackDef; catalog: ManifestCatalog } | null = null;

    if (localDir) {
        result = fetchLocalPack(packName, localDir);
    }

    if (!result) {
        result = await fetchRemotePack(packName);
    }

    if (!result) return cached ?? null; // serve stale if fetch fails

    const entry: CacheEntry = {
        catalog: result.catalog,
        pack: result.pack,
        expiresAt: localDir ? Date.now() + 30_000 : Date.now() + CACHE_TTL_MS, // 30s cache for local (faster iteration)
    };

    packCache.set(packName, entry);
    return entry;
}

// ---------------------------------------------------------------------------
// Merge catalogs
// ---------------------------------------------------------------------------

function mergeCatalogs(base: ManifestCatalog, extension: ManifestCatalog): ManifestCatalog {
    const merged: ManifestCatalog = {
        tools: new Map(base.tools),
        workflows: new Map(base.workflows),
        useCases: new Map(base.useCases),
        skills: new Map(base.skills),
        knowledgeBases: new Map(base.knowledgeBases),
    };

    for (const [name, tool] of extension.tools) {
        merged.tools.set(name, tool);
    }
    for (const [name, wf] of extension.workflows) {
        merged.workflows.set(name, wf);
    }
    for (const [name, uc] of extension.useCases) {
        merged.useCases.set(name, uc);
    }
    for (const [name, skill] of extension.skills) {
        merged.skills.set(name, skill);
    }
    for (const [name, kb] of extension.knowledgeBases) {
        merged.knowledgeBases.set(name, kb);
    }

    return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a merged catalog for a set of pack names.
 * - "core" is always loaded from the bundle (sync, instant).
 * - Other packs are fetched from ManifestStore (async, cached 5min).
 * - Extension packs can reference tools from inherited packs.
 */
export async function loadCatalogForPacks(packNames: string[]): Promise<ManifestCatalog> {
    // Always start with core
    let catalog = getCoreCatalog();

    // Deduplicate and remove "core" (already loaded)
    const remotePacks = [...new Set(packNames)].filter((p) => p !== "core");

    if (remotePacks.length === 0) {
        return catalog;
    }

    // Fetch all remote packs in parallel
    const results = await Promise.all(remotePacks.map((p) => getRemotePack(p)));

    for (const result of results) {
        if (!result) continue;
        catalog = mergeCatalogs(catalog, result.catalog);
    }

    // Validate cross-references: workflows reference tools, use-cases reference workflows
    validateCrossReferences(catalog);

    return catalog;
}

/**
 * Get pack metadata for loaded packs.
 */
export async function getPackDefs(packNames: string[]): Promise<PackDef[]> {
    const defs: PackDef[] = [CORE_PACK];

    const remotePacks = [...new Set(packNames)].filter((p) => p !== "core");
    const results = await Promise.all(remotePacks.map((p) => getRemotePack(p)));

    for (const result of results) {
        if (result) defs.push(result.pack);
    }

    return defs;
}

/**
 * Clear all cached packs (useful for testing or forced refresh).
 */
export function clearPackCache(): void {
    packCache.clear();
    _coreCatalog = null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCrossReferences(catalog: ManifestCatalog): void {
    // Warn about broken references (don't throw — extension packs may have partial refs)
    for (const [wfName, wf] of catalog.workflows) {
        for (const toolRef of wf.tools) {
            if (!catalog.tools.has(toolRef)) {
                logger.warn({ workflow: wfName, tool: toolRef }, "Workflow references unknown tool");
            }
        }
    }

    for (const [ucName, uc] of catalog.useCases) {
        for (const wfRef of uc.workflows) {
            if (!catalog.workflows.has(wfRef)) {
                logger.warn({ useCase: ucName, workflow: wfRef }, "UseCase references unknown workflow");
            }
        }
    }

    for (const [skillName, skill] of catalog.skills) {
        for (const toolRef of skill.tools) {
            if (!catalog.tools.has(toolRef)) {
                logger.warn({ skill: skillName, tool: toolRef }, "Skill references unknown tool");
            }
        }
    }
}
