// SPDX-License-Identifier: AGPL-3.0-only

// ---------------------------------------------------------------------------
// Eval result types
// ---------------------------------------------------------------------------

export interface TriggerCaseResult {
    query: string;
    expected: boolean;
    actual: boolean;
    pass: boolean;
}

export interface ExpectationResult {
    type: string;
    value: string;
    pass: boolean;
    detail?: string;
}

export interface ExecutionCaseResult {
    id: string;
    prompt: string;
    expectations: ExpectationResult[];
    score: number;
    pass: boolean;
}

export interface EvalResult {
    name: string;
    targetKind: string;
    targetName: string;
    triggerResults: TriggerCaseResult[];
    executionResults: ExecutionCaseResult[];
    triggerPassRate: number;
    executionPassRate: number;
    overallPass: boolean;
}

export interface EvalSummary {
    results: EvalResult[];
    threshold: number;
    totalPass: number;
    totalFail: number;
    overallPass: boolean;
}

// ---------------------------------------------------------------------------
// Human-readable formatter
// ---------------------------------------------------------------------------

export function formatEvalHuman(summary: EvalSummary): string {
    const lines: string[] = [];

    lines.push("");
    lines.push("=== Eval Results ===");

    for (const result of summary.results) {
        lines.push("");
        lines.push(`${result.name} (target: ${result.targetKind}/${result.targetName})`);

        if (result.triggerResults.length > 0) {
            const triggerPassed = result.triggerResults.filter((r) => r.pass).length;
            const triggerTotal = result.triggerResults.length;
            const triggerPct = Math.round((triggerPassed / triggerTotal) * 100);
            const triggerStatus = triggerPct >= summary.threshold * 100 ? "PASS" : "FAIL";
            lines.push(`  Trigger: ${triggerPassed}/${triggerTotal} passed (${triggerPct}%)  ${triggerStatus}`);

            for (const tc of result.triggerResults) {
                if (!tc.pass) {
                    lines.push(`    FAIL: "${tc.query}" expected=${tc.expected} got=${tc.actual}`);
                }
            }
        }

        if (result.executionResults.length > 0) {
            const execPassed = result.executionResults.filter((r) => r.pass).length;
            const execTotal = result.executionResults.length;
            const avgScore = result.executionResults.reduce((sum, r) => sum + r.score, 0) / execTotal;
            const execStatus = execPassed / execTotal >= summary.threshold ? "PASS" : "FAIL";
            lines.push(`  Execution: ${execPassed}/${execTotal} passed (score: ${avgScore.toFixed(2)})  ${execStatus}`);

            for (const ec of result.executionResults) {
                if (!ec.pass) {
                    lines.push(`    FAIL [${ec.id}]: "${ec.prompt}"`);
                    for (const exp of ec.expectations) {
                        if (!exp.pass) {
                            lines.push(`      - ${exp.type}(${exp.value}): ${exp.detail ?? "failed"}`);
                        }
                    }
                }
            }
        }
    }

    lines.push("");
    lines.push(
        `Overall: ${summary.totalPass}/${summary.totalPass + summary.totalFail} evals passed (threshold: ${Math.round(summary.threshold * 100)}%)`,
    );

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

export function formatEvalJson(summary: EvalSummary): string {
    return JSON.stringify(summary, null, 2);
}
