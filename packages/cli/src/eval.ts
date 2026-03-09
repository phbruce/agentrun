// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { classifyQuery, EvalManifestSchema } from "@agentrun-ai/core";
import type { EvalDef, SkillDef } from "@agentrun-ai/core";
import type {
    EvalResult,
    EvalSummary,
    TriggerCaseResult,
    ExecutionCaseResult,
    ExpectationResult,
} from "./evalOutput.js";

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

function loadEvalManifests(dir: string, filter?: string): EvalDef[] {
    const evalsDir = path.join(dir, "evals");
    if (!fs.existsSync(evalsDir)) return [];

    const evals: EvalDef[] = [];
    for (const entry of fs.readdirSync(evalsDir)) {
        if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
        const content = fs.readFileSync(path.join(evalsDir, entry), "utf-8");
        const doc = yaml.load(content) as any;
        if (doc?.kind !== "Eval") continue;

        const parsed = EvalManifestSchema.parse(doc);
        const evalDef: EvalDef = {
            name: parsed.metadata.name,
            target: parsed.spec.target,
            triggerCases: parsed.spec.triggerCases,
            executionCases: parsed.spec.executionCases,
            config: parsed.spec.config,
        };

        if (filter && !evalDef.name.includes(filter)) continue;
        evals.push(evalDef);
    }

    return evals;
}

function loadSkillManifests(dir: string): Map<string, SkillDef> {
    const skillsDir = path.join(dir, "skills");
    if (!fs.existsSync(skillsDir)) return new Map();

    const skills = new Map<string, SkillDef>();
    for (const entry of fs.readdirSync(skillsDir)) {
        if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
        const content = fs.readFileSync(path.join(skillsDir, entry), "utf-8");
        const doc = yaml.load(content) as any;
        if (doc?.kind !== "Skill") continue;

        skills.set(doc.metadata.name, {
            name: doc.metadata.name,
            command: doc.spec.command,
            description: doc.spec.description ?? "",
            prompt: doc.spec.prompt ?? "",
            tools: doc.spec.tools ?? [],
            allowedRoles: doc.spec.allowedRoles ?? [],
            maxTurns: doc.spec.maxTurns ?? 5,
            maxBudgetUsd: doc.spec.maxBudgetUsd ?? 0.1,
            args: doc.spec.args ?? false,
            mode: doc.spec.mode ?? "agent",
        });
    }

    return skills;
}

// ---------------------------------------------------------------------------
// Tool → classifier category mapping
// ---------------------------------------------------------------------------

const TOOL_TO_CATEGORIES: Record<string, string[]> = {
    describe_eks_cluster: ["kubernetes"],
    describe_rds: ["database"],
    list_lambdas: ["lambda"],
    get_lambda_details: ["lambda"],
    search_cloudwatch_logs: ["logs"],
    list_sqs_queues: ["sqs"],
    get_sqs_attributes: ["sqs"],
    list_open_prs: ["pull_requests"],
    get_pr_details: ["pull_requests"],
    recent_commits: ["pull_requests"],
};

function getSkillCategories(skill: SkillDef): Set<string> {
    const categories = new Set<string>();

    for (const tool of skill.tools) {
        const cats = TOOL_TO_CATEGORIES[tool];
        if (cats) {
            for (const c of cats) categories.add(c);
        }
    }

    // Multi-category skills (3+) also trigger on "generic" queries
    // e.g., "como esta a infra?" → generic → health-check (uses eks+rds+lambda+sqs)
    if (categories.size >= 3) {
        categories.add("generic");
    }

    return categories;
}

// ---------------------------------------------------------------------------
// Trigger evaluation (fast — pure classifyQuery, no LLM)
// ---------------------------------------------------------------------------

function runTriggerCases(
    evalDef: EvalDef,
    skillCategories: Set<string>,
    onProgress?: (msg: string) => void,
): TriggerCaseResult[] {
    const results: TriggerCaseResult[] = [];

    for (const tc of evalDef.triggerCases) {
        const category = classifyQuery(tc.query);
        const triggered = skillCategories.has(category);

        onProgress?.(`  trigger: "${tc.query}" → ${category} → ${triggered ? "yes" : "no"}`);

        results.push({
            query: tc.query,
            expected: tc.shouldTrigger,
            actual: triggered,
            pass: triggered === tc.shouldTrigger,
        });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Execution evaluation (placeholder — needs runtime)
// ---------------------------------------------------------------------------

function runExecutionCases(
    evalDef: EvalDef,
    onProgress?: (msg: string) => void,
): ExecutionCaseResult[] {
    const results: ExecutionCaseResult[] = [];

    for (const ec of evalDef.executionCases) {
        onProgress?.(`  execution [${ec.id}]: skipped (needs AWS runtime)`);

        const expectations: ExpectationResult[] = ec.expectations.map((exp) => ({
            type: exp.type,
            value: exp.value,
            pass: false,
            detail: "skipped — execution eval requires AWS runtime",
        }));

        results.push({ id: ec.id, prompt: ec.prompt, expectations, score: 0, pass: false });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

export type EvalMode = "trigger" | "execution" | "all";

export interface EvalOptions {
    dir: string;
    mode: EvalMode;
    filter?: string;
    threshold: number;
    onProgress?: (msg: string) => void;
}

export async function runEvals(options: EvalOptions): Promise<EvalSummary> {
    const { dir, mode, filter, threshold, onProgress } = options;

    const evalDefs = loadEvalManifests(dir, filter);
    if (evalDefs.length === 0) {
        return { results: [], threshold, totalPass: 0, totalFail: 0, overallPass: true };
    }

    const skills = loadSkillManifests(dir);

    onProgress?.(`Found ${evalDefs.length} eval(s), ${skills.size} skill(s)\n`);

    const results: EvalResult[] = [];

    for (const evalDef of evalDefs) {
        onProgress?.(`\nRunning: ${evalDef.name} (target: ${evalDef.target.kind}/${evalDef.target.name})`);

        // Resolve skill categories for trigger eval
        const skill = skills.get(evalDef.target.name);
        const skillCategories = skill ? getSkillCategories(skill) : new Set<string>();

        if (skill) {
            onProgress?.(`  skill "${skill.command}" tools: [${skill.tools.join(", ")}] → categories: [${[...skillCategories].join(", ")}]`);
        } else {
            onProgress?.(`  ⚠ skill "${evalDef.target.name}" not found in manifests`);
        }

        let triggerResults: TriggerCaseResult[] = [];
        let executionResults: ExecutionCaseResult[] = [];

        if ((mode === "trigger" || mode === "all") && evalDef.triggerCases.length > 0) {
            triggerResults = runTriggerCases(evalDef, skillCategories, onProgress);
        }

        if ((mode === "execution" || mode === "all") && evalDef.executionCases.length > 0) {
            executionResults = runExecutionCases(evalDef, onProgress);
        }

        const triggerPassRate =
            triggerResults.length > 0
                ? triggerResults.filter((r) => r.pass).length / triggerResults.length
                : 1;

        const executionPassRate =
            executionResults.length > 0
                ? executionResults.filter((r) => r.pass).length / executionResults.length
                : 1;

        const overallPass = triggerPassRate >= threshold && executionPassRate >= threshold;

        results.push({
            name: evalDef.name,
            targetKind: evalDef.target.kind,
            targetName: evalDef.target.name,
            triggerResults,
            executionResults,
            triggerPassRate,
            executionPassRate,
            overallPass,
        });
    }

    const totalPass = results.filter((r) => r.overallPass).length;
    const totalFail = results.length - totalPass;

    return {
        results,
        threshold,
        totalPass,
        totalFail,
        overallPass: totalFail === 0,
    };
}
