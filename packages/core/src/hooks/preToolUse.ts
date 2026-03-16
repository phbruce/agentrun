// SPDX-License-Identifier: AGPL-3.0-only

import type { Role } from "../rbac/types.js";
import { getAllowedToolsForRole } from "../rbac/permissions.js";
import { logger } from "../logger.js";

/**
 * Creates a pre-tool-use hook that enforces RBAC.
 * Blocks tool calls not allowed for the user's role.
 */
export function createPreToolUseHook(role: Role, _isDm?: boolean) {
    const allowedTools = getAllowedToolsForRole(role);

    return async (input: any): Promise<any> => {
        const toolName = input?.tool_name ?? input?.name;
        if (!toolName) return input;

        // Check if the tool is allowed for the user's role
        if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
            logger.warn({ tool: toolName, role }, "Tool blocked by RBAC");
            return { ...input, blocked: true, reason: `Tool ${toolName} not allowed for role ${role}` };
        }

        return input;
    };
}
