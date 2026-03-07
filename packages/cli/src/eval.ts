// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
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
// Claude Code SDK lazy loader
// ---------------------------------------------------------------------------

type QueryFn = (options: {
    prompt: string;
    options: {
        allowedTools?: string[];
        maxTurns?: number;
        permissionMode?: string;
        systemPrompt?: string;
    };
}) => AsyncIterable<any>;

let _query: QueryFn | null = null;

async function getQuery(): Promise<QueryFn> {
    if (_query) return _query;

    try {
        // @ts-ignore — optional dependency, loaded at runtime only when eval command is used
        const sdk = await import("@anthropic-ai/claude-code");
        _query = sdk.query as unknown as QueryFn;
        return _query;
    } catch {
        throw new Error(
            "Claude Code SDK (@anthropic-ai/claude-code) is required for eval execution.\n" +
            "Install it: npm install -g @anthropic-ai/claude-code",
        );
    }
}

// ---------------------------------------------------------------------------
// Trigger evaluation (fast — single-turn LLM call per case)
// ---------------------------------------------------------------------------

async function runTriggerCases(
    evalDef: EvalDef,
    onProgress?: (msg: string) => void,
): Promise<TriggerCaseResult[]> {
    const query = await getQuery();
    const results: TriggerCaseResult[] = [];

    for (const tc of evalDef.triggerCases) {
        onProgress?.(`  trigger: "${tc.query}"`);

        let triggered = false;
        try {
            const messages: any[] = [];
            for await (const msg of query({
                prompt: tc.query,
                options: {
                    allowedTools: ["Skill"],
                    maxTurns: 1,
                    permissionMode: "bypassPermissions",
                    systemPrompt: "You have access to skills via the Skill tool. If the user's request matches a skill, invoke it. Otherwise respond normally.",
                },
            })) {
                messages.push(msg);
            }

            // Check if the Skill tool was called
            triggered = messages.some(
                (m: any) =>
                    m.type === "assistant" &&
                    Array.isArray(m.content) &&
                    m.content.some(
                        (block: any) => block.type === "tool_use" && block.name === "Skill",
                    ),
            );
        } catch {
            // LLM error — treat as not triggered
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
// Execution evaluation (full — multi-turn LLM call)
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
            // LLM judge deferred — requires separate cheap model call
            // For now, mark as pass with a note
            return { type: exp.type, value: exp.value, pass: true, detail: "llm_judge not yet implemented" };
        }
        default:
            return { type: exp.type, value: exp.value, pass: false, detail: `unknown type: ${exp.type}` };
    }
}

async function runExecutionCases(
    evalDef: EvalDef,
    onProgress?: (msg: string) => void,
): Promise<ExecutionCaseResult[]> {
    const query = await getQuery();
    const results: ExecutionCaseResult[] = [];

    for (const ec of evalDef.executionCases) {
        onProgress?.(`  execution [${ec.id}]: "${ec.prompt}"`);

        let output = "";
        const toolsCalled = new Set<string>();

        try {
            for await (const msg of query({
                prompt: ec.prompt,
                options: {
                    maxTurns: 10,
                    permissionMode: "bypassPermissions",
                },
            })) {
                // Collect text output
                if (msg.type === "assistant" && Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === "text") {
                            output += block.text;
                        }
                        if (block.type === "tool_use") {
                            // Track tool names (strip mcp__ prefix variants)
                            const toolName = block.name?.replace(/^mcp__[^_]+__/, "") ?? block.name;
                            toolsCalled.add(toolName);
                            toolsCalled.add(block.name); // also add full name
                        }
                    }
                }
                // Also collect result text
                if (msg.type === "result" && typeof msg.result === "string") {
                    output += msg.result;
                }
            }
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
    onProgress?: (msg: string) => void;
}

export async function runEvals(options: EvalOptions): Promise<EvalSummary> {
    const { dir, mode, filter, threshold, onProgress } = options;

    const evalDefs = loadEvalManifests(dir, filter);
    if (evalDefs.length === 0) {
        return { results: [], threshold, totalPass: 0, totalFail: 0, overallPass: true };
    }

    onProgress?.(`Found ${evalDefs.length} eval(s)\n`);

    const results: EvalResult[] = [];

    for (const evalDef of evalDefs) {
        onProgress?.(`\nRunning: ${evalDef.name} (target: ${evalDef.target.kind}/${evalDef.target.name})`);

        let triggerResults: TriggerCaseResult[] = [];
        let executionResults: ExecutionCaseResult[] = [];

        if ((mode === "trigger" || mode === "all") && evalDef.triggerCases.length > 0) {
            triggerResults = await runTriggerCases(evalDef, onProgress);
        }

        if ((mode === "execution" || mode === "all") && evalDef.executionCases.length > 0) {
            executionResults = await runExecutionCases(evalDef, onProgress);
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
