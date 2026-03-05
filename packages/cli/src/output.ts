// SPDX-License-Identifier: AGPL-3.0-only

import type { ValidationResult } from "./validate.js";

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

export function formatHuman(result: ValidationResult): string {
    const lines: string[] = [];

    lines.push("");
    lines.push("=== Manifest Validation ===");
    lines.push("");
    lines.push(`Files validated: ${result.files}`);
    lines.push(`Tools: ${result.tools}`);
    lines.push(`Workflows: ${result.workflows}`);
    lines.push(`UseCases: ${result.useCases}`);
    lines.push(`Skills: ${result.skills}`);

    if (result.securityFlags.length > 0) {
        lines.push("");
        lines.push(`Security flags (${result.securityFlags.length}):`);
        for (const sf of result.securityFlags) {
            lines.push(`  ! ${sf.file}: Tool "${sf.tool}" has write action "${sf.action}"`);
        }
    }

    if (result.warnings.length > 0) {
        lines.push("");
        lines.push(`Warnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
            lines.push(`  ~ ${w.file}: ${w.message}`);
        }
    }

    if (result.errors.length > 0) {
        lines.push("");
        lines.push(`Errors (${result.errors.length}):`);
        for (const e of result.errors) {
            lines.push(`  x ${e.file}: ${e.message}`);
        }
    }

    if (result.errors.length === 0) {
        lines.push("");
        lines.push("OK All manifests valid.");
    }

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

export function formatJson(result: ValidationResult): string {
    return JSON.stringify(result, null, 2);
}
