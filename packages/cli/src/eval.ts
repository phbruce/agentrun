// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import { execFile, execSync } from "child_process";
import yaml from "js-yaml";
import { EvalManifestSchema } from "@agentrun-ai/core";
import type { EvalDef } from "@agentrun-ai/core";
import type {
    EvalResult,
    EvalSummary,
    TriggerCaseResult,
    ExecutionCaseResult,
    ExpectationResult,
} from "./evalOutput.js";

// ---------------------------------------------------------------------------
// Manifest loader (load eval YAMLs from directory)
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

// ---------------------------------------------------------------------------
// Claude CLI subprocess runner
// ---------------------------------------------------------------------------

interface ClaudeResult {
    output: string;
    toolsCalled: Set<string>;
}

function findClaudeBin(): string {
    try {
        const result = execSync("which claude", { encoding: "utf-8" }).trim();
        if (result) return result;
    } catch {
        // fall through
    }
    throw new Error(
        "Claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code\n" +
        "Then authenticate: claude login",
    );
}

function runClaude(prompt: string, maxTurns: number, cwd?: string): Promise<ClaudeResult> {
    const bin = findClaudeBin();

    return new Promise((resolve, reject) => {
        const args = [
            "-p", prompt,
            "--output-format", "stream-json",
            "--max-turns", String(maxTurns),
            "--verbose",
        ];

        const child = execFile(bin, args, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
            cwd: cwd ?? process.cwd(),
            env: { ...process.env },
        }, (err, stdout, stderr) => {
            if (err && !stdout) {
                reject(new Error(`Claude CLI failed: ${err.message}`));
                return;
            }

            let output = "";
            const toolsCalled = new Set<string>();

            // Parse stream-json: one JSON object per line
            for (const line of stdout.split("\n")) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);

                    // Collect text from assistant messages
                    if (msg.type === "assistant" && Array.isArray(msg.content)) {
                        for (const block of msg.content) {
                            if (block.type === "text") {
                                output += block.text;
                            }
                            if (block.type === "tool_use") {
                                const toolName = block.name?.replace(/^mcp__[^_]+__/, "") ?? block.name;
                                toolsCalled.add(toolName);
                                toolsCalled.add(block.name);
                            }
                        }
                    }

                    // Collect result text
                    if (msg.type === "result" && typeof msg.result === "string") {
                        output += msg.result;
                    }
                } catch {
                    // Not valid JSON, skip
                }
            }

            resolve({ output, toolsCalled });
        });
    });
}

// ---------------------------------------------------------------------------
// Trigger evaluation (fast — single-turn CLI call per case)
// ---------------------------------------------------------------------------

async function runTriggerCases(
    evalDef: EvalDef,
    cwd?: string,
    onProgress?: (msg: string) => void,
): Promise<TriggerCaseResult[]> {
    const results: TriggerCaseResult[] = [];

    for (const tc of evalDef.triggerCases) {
        onProgress?.(`  trigger: "${tc.query}"`);

        let triggered = false;
        try {
            const { toolsCalled } = await runClaude(tc.query, 1, cwd);
            // Check if the Skill tool was called
            triggered = toolsCalled.has("Skill");
        } catch {
            triggered = false;
        }

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
// Execution evaluation (full — multi-turn CLI call)
// ---------------------------------------------------------------------------

function checkExpectation(
    exp: { type: string; value: string },
    output: string,
    toolsCalled: Set<string>,
): ExpectationResult {
    switch (exp.type) {
        case "contains": {
            const pass = output.toLowerCase().includes(exp.value.toLowerCase());
            return { type: exp.type, value: exp.value, pass, detail: pass ? undefined : "not found in output" };
        }
        case "not_contains": {
            const pass = !output.toLowerCase().includes(exp.value.toLowerCase());
            return { type: exp.type, value: exp.value, pass, detail: pass ? undefined : "found in output" };
        }
        case "tool_called": {
            const pass = toolsCalled.has(exp.value);
            return {
                type: exp.type,
                value: exp.value,
                pass,
                detail: pass ? undefined : `tool not called (called: ${[...toolsCalled].join(", ") || "none"})`,
            };
        }
        case "tool_not_called": {
            const pass = !toolsCalled.has(exp.value);
            return { type: exp.type, value: exp.value, pass, detail: pass ? undefined : "tool was called" };
        }
        case "matches_regex": {
            try {
                const regex = new RegExp(exp.value, "i");
                const pass = regex.test(output);
                return { type: exp.type, value: exp.value, pass, detail: pass ? undefined : "regex did not match" };
            } catch {
                return { type: exp.type, value: exp.value, pass: false, detail: "invalid regex" };
            }
        }
        case "llm_judge": {
            return { type: exp.type, value: exp.value, pass: true, detail: "llm_judge not yet implemented" };
        }
        default:
            return { type: exp.type, value: exp.value, pass: false, detail: `unknown type: ${exp.type}` };
    }
}

async function runExecutionCases(
    evalDef: EvalDef,
    cwd?: string,
    onProgress?: (msg: string) => void,
): Promise<ExecutionCaseResult[]> {
    const results: ExecutionCaseResult[] = [];

    for (const ec of evalDef.executionCases) {
        onProgress?.(`  execution [${ec.id}]: "${ec.prompt}"`);

        let output = "";
        let toolsCalled = new Set<string>();

        try {
            const result = await runClaude(ec.prompt, 10, cwd);
            output = result.output;
            toolsCalled = result.toolsCalled;
        } catch (err: any) {
            output = `[ERROR] ${err.message}`;
        }

        const expectations: ExpectationResult[] = ec.expectations.map((exp) =>
            checkExpectation(exp, output, toolsCalled),
        );

        const passedCount = expectations.filter((e) => e.pass).length;
        const score = expectations.length > 0 ? passedCount / expectations.length : 0;
        const pass = score >= evalDef.config.passThreshold;

        results.push({ id: ec.id, prompt: ec.prompt, expectations, score, pass });
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
    cwd?: string;
    onProgress?: (msg: string) => void;
}

export async function runEvals(options: EvalOptions): Promise<EvalSummary> {
    const { dir, mode, filter, threshold, onProgress } = options;

    // Resolve project root: walk up from dir to find the directory containing .claude/
    let projectCwd = options.cwd;
    if (!projectCwd) {
        const absDir = path.resolve(dir);
        let candidate = absDir;
        while (candidate !== path.dirname(candidate)) {
            if (fs.existsSync(path.join(candidate, ".claude"))) {
                projectCwd = candidate;
                break;
            }
            candidate = path.dirname(candidate);
        }
    }

    const evalDefs = loadEvalManifests(dir, filter);
    if (evalDefs.length === 0) {
        return { results: [], threshold, totalPass: 0, totalFail: 0, overallPass: true };
    }

    // Verify claude CLI is available upfront
    findClaudeBin();

    onProgress?.(`Found ${evalDefs.length} eval(s)${projectCwd ? ` (cwd: ${projectCwd})` : ""}\n`);

    const results: EvalResult[] = [];

    for (const evalDef of evalDefs) {
        onProgress?.(`\nRunning: ${evalDef.name} (target: ${evalDef.target.kind}/${evalDef.target.name})`);

        let triggerResults: TriggerCaseResult[] = [];
        let executionResults: ExecutionCaseResult[] = [];

        if ((mode === "trigger" || mode === "all") && evalDef.triggerCases.length > 0) {
            triggerResults = await runTriggerCases(evalDef, projectCwd, onProgress);
        }

        if ((mode === "execution" || mode === "all") && evalDef.executionCases.length > 0) {
            executionResults = await runExecutionCases(evalDef, projectCwd, onProgress);
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
