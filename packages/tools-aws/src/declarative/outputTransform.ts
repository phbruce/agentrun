// SPDX-License-Identifier: AGPL-3.0-only

import { search } from "@metrichor/jmespath";

/**
 * Apply a JMESPath expression to transform a tool's raw output.
 * Returns the original data unchanged if no expression is provided.
 */
export function applyOutputTransform(data: unknown, expression?: string): unknown {
    if (!expression) return data;

    try {
        return search(data as Parameters<typeof search>[0], expression);
    } catch (err: any) {
        throw new Error(`Output transform failed (JMESPath: "${expression}"): ${err.message}`);
    }
}
