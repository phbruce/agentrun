// SPDX-License-Identifier: AGPL-3.0-only

import type { ResolvedSecrets } from "@agentrun-oss/core";

// ---------------------------------------------------------------------------
// Built-in variables available in all templates
// ---------------------------------------------------------------------------

function getBuiltins(): Record<string, string> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Last day of the current month
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // First day of the current month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const fmt = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

    return {
        today: fmt(now),
        tomorrow: fmt(tomorrow),
        monthStart: fmt(monthStart),
        monthEnd: fmt(monthEnd),
        now: now.toISOString(),
        region: process.env.AWS_REGION ?? "us-east-1",
        account_id: process.env.AWS_ACCOUNT_ID ?? "",
    };
}

// ---------------------------------------------------------------------------
// Interpolation engine
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Recursively interpolate `{{ var }}` placeholders in a value.
 *
 * Resolution order:
 *   1. `{{ secrets.NAME }}`  -> resolvedSecrets.get("NAME")
 *   2. `{{ argName }}`       -> args[argName]
 *   3. `{{ today }}` etc.    -> built-in variables
 *
 * Works on strings, arrays, and plain objects (deep).
 */
export function interpolate(
    value: unknown,
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
): unknown {
    if (typeof value === "string") {
        return interpolateString(value, args, secrets);
    }
    if (Array.isArray(value)) {
        return value.map((v) => interpolate(v, args, secrets));
    }
    if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = interpolate(v, args, secrets);
        }
        return result;
    }
    return value;
}

function resolveDeepKey(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function interpolateString(
    template: string,
    args: Record<string, unknown>,
    secrets: ResolvedSecrets,
): string {
    const builtins = getBuiltins();

    return template.replace(TEMPLATE_RE, (_match, expr: string) => {
        const key = expr.trim();

        // secrets.NAME
        if (key.startsWith("secrets.")) {
            const secretName = key.slice("secrets.".length);
            const val = secrets.get(secretName);
            if (val === undefined) {
                throw new Error(`Secret "${secretName}" not resolved`);
            }
            return val;
        }

        // Deep path resolution: steps.fetch_costs.result, etc.
        if (key.includes(".")) {
            const resolved = resolveDeepKey(args, key);
            if (resolved !== undefined) {
                return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
            }
        }

        // args (flat)
        if (key in args) {
            return String(args[key]);
        }

        // builtins
        if (key in builtins) {
            return builtins[key];
        }

        throw new Error(`Unknown template variable: "${key}"`);
    });
}
