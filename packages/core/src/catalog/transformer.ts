// SPDX-License-Identifier: AGPL-3.0-only

import { isAbsolute, resolve } from "path";

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
