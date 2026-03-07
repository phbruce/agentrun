// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { z } from "zod";
import {
    PackManifestSchema,
    RemoteToolSchema,
    RemoteWorkflowSchema,
    RemoteUseCaseSchema,
    RemoteSkillSchema,
    RemoteKnowledgeBaseSchema,
    UserSkillSchema,
    EvalManifestSchema,
} from "@agentrun-ai/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
    file: string;
    message: string;
}

export interface ValidationWarning {
    file: string;
    message: string;
}

export interface SecurityFlag {
    file: string;
    tool: string;
    action: string;
}

export interface ValidationResult {
    files: number;
    tools: number;
    workflows: number;
    useCases: number;
    skills: number;
    evals: number;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    securityFlags: SecurityFlag[];
}

// ---------------------------------------------------------------------------
// Security scan
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = ["Put", "Create", "Delete", "Update", "Remove", "Terminate", "Stop"];

// ---------------------------------------------------------------------------
// File walker (recursive, all YAML files)
// ---------------------------------------------------------------------------

function walkYaml(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkYaml(full));
        } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
            results.push(full);
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

export function validateManifests(dir: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const securityFlags: SecurityFlag[] = [];

    const toolNames = new Set<string>();
    const workflowNames = new Set<string>();
    const skillNames = new Set<string>();
    const useCaseNames = new Set<string>();
    const evalTargets: Array<{ file: string; kind: string; name: string }> = [];
    let fileCount = 0;
    let toolCount = 0;
    let workflowCount = 0;
    let useCaseCount = 0;
    let skillCount = 0;
    let evalCount = 0;

    const allFiles = walkYaml(dir);

    // Pass 1: Schema validation + collect names
    for (const file of allFiles) {
        const relPath = path.relative(dir, file);

        // Skip non-manifest files
        if (relPath === "config.yaml" || relPath === "config.yml") continue;
        if (relPath === "hooks-example.json") continue;
        if (relPath.startsWith("user-skills" + path.sep)) continue;

        let content: string;
        try {
            content = fs.readFileSync(file, "utf-8");
        } catch (err: any) {
            errors.push({ file: relPath, message: `Read error: ${err.message}` });
            continue;
        }

        let doc: any;
        try {
            doc = yaml.load(content);
        } catch (err: any) {
            errors.push({ file: relPath, message: `YAML parse error: ${err.message}` });
            continue;
        }

        if (!doc || typeof doc !== "object" || !doc.kind) continue;

        fileCount++;

        try {
            switch (doc.kind) {
                case "Tool": {
                    RemoteToolSchema.parse(doc);
                    toolNames.add(doc.metadata.name);
                    toolCount++;

                    // Security: check for write actions in aws-sdk tools
                    if (doc.spec.type === "aws-sdk" && doc.spec.awsSdk?.action) {
                        for (const wa of WRITE_ACTIONS) {
                            if (doc.spec.awsSdk.action.startsWith(wa)) {
                                securityFlags.push({
                                    file: relPath,
                                    tool: doc.metadata.name,
                                    action: doc.spec.awsSdk.action,
                                });
                            }
                        }
                    }
                    break;
                }
                case "Workflow":
                    RemoteWorkflowSchema.parse(doc);
                    workflowNames.add(doc.metadata.name);
                    workflowCount++;
                    break;
                case "UseCase":
                    RemoteUseCaseSchema.parse(doc);
                    useCaseNames.add(doc.metadata.name);
                    useCaseCount++;
                    break;
                case "Skill":
                    RemoteSkillSchema.parse(doc);
                    skillNames.add(doc.metadata.name);
                    skillCount++;
                    break;
                case "Eval":
                    EvalManifestSchema.parse(doc);
                    evalTargets.push({ file: relPath, kind: doc.spec.target.kind, name: doc.spec.target.name });
                    evalCount++;
                    break;
                case "KnowledgeBase":
                    RemoteKnowledgeBaseSchema.parse(doc);
                    break;
                case "UserSkill":
                    UserSkillSchema.parse(doc);
                    break;
                case "Pack":
                    PackManifestSchema.parse(doc);
                    break;
                default:
                    warnings.push({ file: relPath, message: `Unknown kind "${doc.kind}"` });
            }
        } catch (err: any) {
            if (err instanceof z.ZodError) {
                const issues = err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
                errors.push({ file: relPath, message: `Schema validation failed:\n${issues}` });
            } else {
                errors.push({ file: relPath, message: `Parse error: ${err.message}` });
            }
        }
    }

    // Pass 2: Cross-reference validation
    for (const file of allFiles) {
        const relPath = path.relative(dir, file);
        if (relPath === "config.yaml" || relPath === "config.yml") continue;
        if (relPath.startsWith("user-skills" + path.sep)) continue;

        try {
            const content = fs.readFileSync(file, "utf-8");
            const doc = yaml.load(content) as any;
            if (!doc || !doc.kind) continue;

            if (doc.kind === "Workflow" && doc.spec?.tools) {
                for (const toolRef of doc.spec.tools) {
                    if (!toolNames.has(toolRef)) {
                        warnings.push({
                            file: relPath,
                            message: `Workflow "${doc.metadata.name}" references unknown tool "${toolRef}"`,
                        });
                    }
                }
            }

            if (doc.kind === "UseCase" && doc.spec?.workflows) {
                for (const wfRef of doc.spec.workflows) {
                    if (!workflowNames.has(wfRef)) {
                        warnings.push({
                            file: relPath,
                            message: `UseCase "${doc.metadata.name}" references unknown workflow "${wfRef}"`,
                        });
                    }
                }
            }

            if (doc.kind === "Skill" && doc.spec?.tools) {
                for (const toolRef of doc.spec.tools) {
                    if (!toolNames.has(toolRef)) {
                        warnings.push({
                            file: relPath,
                            message: `Skill "${doc.metadata.name}" references unknown tool "${toolRef}"`,
                        });
                    }
                }
            }
        } catch {
            // Already reported in pass 1
        }
    }

    // Pass 3: Eval target cross-reference
    for (const { file, kind, name } of evalTargets) {
        const targetSet = kind === "Skill" ? skillNames : useCaseNames;
        if (!targetSet.has(name)) {
            warnings.push({
                file,
                message: `Eval targets unknown ${kind} "${name}"`,
            });
        }
    }

    return {
        files: fileCount,
        tools: toolCount,
        workflows: workflowCount,
        useCases: useCaseCount,
        skills: skillCount,
        evals: evalCount,
        errors,
        warnings,
        securityFlags,
    };
}
