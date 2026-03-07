// SPDX-License-Identifier: AGPL-3.0-only

import yaml from "js-yaml";
import type { ManifestCatalog, ToolDef, WorkflowDef, UseCaseDef, SkillDef } from "./types.js";
import {
    RemoteToolSchema,
    RemoteWorkflowSchema,
    RemoteUseCaseSchema,
    RemoteSkillSchema,
} from "./packTypes.js";

/**
 * Load manifests from raw YAML content maps.
 * In production, manifests are loaded from packs (S3/filesystem) via packLoader.
 * This function parses and validates the raw YAML strings.
 */
export function loadManifestsFromRaw(
    toolManifests: Record<string, string>,
    workflowManifests: Record<string, string>,
    usecaseManifests: Record<string, string>,
    skillManifests: Record<string, string>,
): ManifestCatalog {
    const tools = new Map<string, ToolDef>();
    for (const [file, content] of Object.entries(toolManifests)) {
        const doc = RemoteToolSchema.parse(yaml.load(content as string));
        const t: ToolDef = {
            name: doc.metadata.name,
            type: doc.spec.type,
            mcpTool: doc.spec.mcpTool,
            skillRef: doc.spec.skillRef,
            description: doc.spec.description,
            category: doc.spec.category,
            awsSdk: doc.spec.awsSdk,
            http: doc.spec.http,
            lambda: doc.spec.lambda,
            secrets: doc.spec.secrets,
        };
        if (tools.has(t.name)) {
            throw new Error(`Duplicate tool name: ${t.name} (file: ${file})`);
        }
        tools.set(t.name, t);
    }

    const workflows = new Map<string, WorkflowDef>();
    for (const [file, content] of Object.entries(workflowManifests)) {
        const doc = RemoteWorkflowSchema.parse(yaml.load(content as string));
        const w: WorkflowDef = {
            name: doc.metadata.name,
            description: doc.spec.description,
            tools: doc.spec.tools,
            steps: doc.spec.steps,
            inputSchema: doc.spec.inputSchema,
        };
        if (workflows.has(w.name)) {
            throw new Error(`Duplicate workflow name: ${w.name} (file: ${file})`);
        }
        for (const toolRef of w.tools) {
            if (!tools.has(toolRef)) {
                throw new Error(`Workflow "${w.name}" references unknown tool: ${toolRef}`);
            }
        }
        workflows.set(w.name, w);
    }

    const useCases = new Map<string, UseCaseDef>();
    for (const [file, content] of Object.entries(usecaseManifests)) {
        const doc = RemoteUseCaseSchema.parse(yaml.load(content as string));
        const uc: UseCaseDef = {
            name: doc.metadata.name,
            description: doc.spec.description,
            keywords: doc.spec.keywords,
            workflows: doc.spec.workflows,
            template: doc.spec.template,
        };
        if (useCases.has(uc.name)) {
            throw new Error(`Duplicate use case name: ${uc.name} (file: ${file})`);
        }
        for (const wfRef of uc.workflows) {
            if (!workflows.has(wfRef)) {
                throw new Error(`Use case "${uc.name}" references unknown workflow: ${wfRef}`);
            }
        }
        useCases.set(uc.name, uc);
    }

    const skills = new Map<string, SkillDef>();
    for (const [file, content] of Object.entries(skillManifests)) {
        const doc = RemoteSkillSchema.parse(yaml.load(content as string));
        const s: SkillDef = {
            name: doc.metadata.name,
            command: doc.spec.command,
            description: doc.spec.description,
            prompt: doc.spec.prompt,
            tools: doc.spec.tools,
            allowedRoles: doc.spec.allowedRoles,
            maxTurns: doc.spec.maxTurns,
            maxBudgetUsd: doc.spec.maxBudgetUsd,
            args: doc.spec.args,
            mode: doc.spec.mode,
        };
        if (skills.has(s.name)) {
            throw new Error(`Duplicate skill name: ${s.name} (file: ${file})`);
        }
        for (const toolRef of s.tools) {
            if (!tools.has(toolRef)) {
                throw new Error(`Skill "${s.name}" references unknown tool: ${toolRef}`);
            }
        }
        skills.set(s.name, s);
    }

    const knowledgeBases = new Map();
    const evals = new Map();
    return { tools, workflows, useCases, skills, knowledgeBases, evals };
}

/**
 * Load an empty catalog (no bundled manifests).
 * Manifests are loaded from packs at runtime via packLoader.
 */
export function loadManifests(): ManifestCatalog {
    return loadManifestsFromRaw({}, {}, {}, {});
}
