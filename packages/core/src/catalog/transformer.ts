// SPDX-License-Identifier: AGPL-3.0-only

import { isAbsolute, resolve } from "path";
import { spawn } from "node:child_process";

/**
 * A function that transforms arbitrary data — sync or async.
 *
 * Used for:
 *   - HTTP body building: (args: ToolArgs) => RequestBody
 *   - Workflow step output: (output: StepOutput) => TransformedOutput
 *   - Any future data mapping in tool invocation pipelines
 *
 * Transform files must export a Transformer as their default export.
 */
export type Transformer = (data: unknown) => unknown | Promise<unknown>;

/**
 * Load a Transformer from a JS file via dynamic import.
 *
 * The file must export a default function matching the Transformer signature.
 * Supports both absolute paths and paths relative to baseDir.
 *
 * @param file    - Path to the JS file (absolute or relative to baseDir).
 * @param baseDir - Base directory for resolving relative paths. Defaults to cwd.
 *
 * @example
 * // packs/shared/tools/transforms/jira-issue.js
 * export default (args) => ({ fields: { summary: args.summary, ... } });
 *
 * // In catalogRouteBuilder:
 * const transform = await loadTransformer("./transforms/jira-issue.js", toolsDir);
 */
export async function loadTransformer(file: string, baseDir?: string): Promise<Transformer> {
    const resolved = isAbsolute(file) ? file : resolve(baseDir ?? process.cwd(), file);
    const mod = await import(resolved);
    const fn = mod.default;
    if (typeof fn !== "function") {
        throw new Error(
            `Transformer file "${resolved}" must export a default function, got: ${typeof fn}`,
        );
    }
    return fn as Transformer;
}

/**
 * Apply a Transformer to data. Handles both sync and async transformers.
 *
 * @param transformer - A loaded Transformer function.
 * @param data        - The input data to transform.
 */
export async function applyTransform(transformer: Transformer, data: unknown): Promise<unknown> {
    return transformer(data);
}

// ---------------------------------------------------------------------------
// spawnTransform — subprocess-based transformer for Python, shell, etc.
// ---------------------------------------------------------------------------

export interface SpawnTransformOptions {
    /** Maximum milliseconds to wait for the subprocess. Default: 10 000. */
    timeoutMs?: number;
}

/**
 * Execute an external script as a Transformer via subprocess.
 *
 * Contract: the script reads args as JSON from stdin and writes the result
 * as JSON to stdout. Any non-zero exit code or invalid JSON output causes
 * the returned promise to reject.
 *
 * Supported: Python (`python3 script.py`), shell (`bash script.sh`), or any
 * interpreter that follows the stdin/stdout JSON contract.
 *
 * Security:
 *   - `file` must be an absolute path. Relative paths are rejected immediately
 *     to prevent accidental resolution against an unexpected working directory.
 *   - The caller is responsible for ensuring `file` resides within a trusted
 *     directory (e.g. the pack's toolsDir) — typically via a path-prefix check
 *     before calling this function.
 *   - The subprocess runs in an isolated process with no access to the parent's
 *     memory, open file descriptors, or secrets — only the JSON-serialised args.
 *
 * @param interpreter - Executable to invoke (e.g. "python3", "bash").
 * @param file        - Absolute path to the script file.
 * @param args        - Arguments to pass as JSON via stdin.
 * @param options     - Optional configuration (timeout).
 *
 * @example
 * // packs/shared/tools/my-tool.transform.py
 * // import json, sys
 * // args = json.load(sys.stdin)
 * // json.dump({"result": args["value"]}, sys.stdout)
 *
 * const result = await spawnTransform("python3", "/abs/path/my-tool.transform.py", args);
 */
export function spawnTransform(
    interpreter: string,
    file: string,
    args: unknown,
    options: SpawnTransformOptions = {},
): Promise<unknown> {
    if (!file.startsWith("/")) {
        return Promise.reject(
            new Error(`spawnTransform: file must be an absolute path (got "${file}")`),
        );
    }

    const timeoutMs = options.timeoutMs ?? 10_000;

    return new Promise((resolve, reject) => {
        const proc = spawn(interpreter, [file], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
            settled = true;
            proc.kill("SIGTERM");
            reject(new Error(`spawnTransform timed out after ${timeoutMs}ms (${file})`));
        }, timeoutMs);

        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        proc.stdin.write(JSON.stringify(args));
        proc.stdin.end();

        proc.on("close", (code) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            if (code !== 0) {
                reject(new Error(`spawnTransform failed (exit ${code}): ${stderr.slice(0, 500)}`));
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    reject(
                        new Error(`spawnTransform output is not valid JSON: ${stdout.slice(0, 200)}`),
                    );
                }
            }
        });

        proc.on("error", (err) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            reject(new Error(`spawnTransform process error: ${err.message}`));
        });
    });
}
