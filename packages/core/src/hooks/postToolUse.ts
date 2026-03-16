// SPDX-License-Identifier: AGPL-3.0-only

import type { Role } from "../rbac/types.js";
import { logger } from "../logger.js";

export interface ToolUsageEntry {
    tool: string;
    timestamp: string;
}

/**
 * Creates a post-tool-use hook that tracks tool usage.
 */
export function createPostToolUseHook(
    toolsUsed: ToolUsageEntry[],
    _role?: Role,
    _userId?: string,
) {
    return async (input: any): Promise<any> => {
        const toolName = input?.tool_name ?? input?.name;
        if (toolName) {
            toolsUsed.push({ tool: toolName, timestamp: new Date().toISOString() });
            logger.debug({ tool: toolName }, "Tool executed");
        }
        return input;
    };
}
