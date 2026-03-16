// SPDX-License-Identifier: AGPL-3.0-only
import type { Action, Role } from "./types.js";
import { getRoleConfigs } from "./roleConfig.js";
import { getMcpToolsForRole } from "../catalog/catalog.js";
import { PlatformRegistry } from "../platform/registry.js";

export { getRoleForUser, getDisplayName, getUserProfile } from "./userRegistry.js";
export type { Role, Action, IdentitySource, UserProfile, RoleConfig } from "./types.js";

/** Build role → actions mapping from config. */
function loadRolePermissions(): Record<string, Action[]> {
    const registry = PlatformRegistry.instance();
    if (!registry.isConfigured) return {};

    const result: Record<string, Action[]> = {};
    for (const [role, def] of Object.entries(registry.config.spec.roles)) {
        result[role] = def.actions;
    }
    return result;
}

let _rolePermissions: Record<string, Action[]> | null = null;

function getRolePermissions(): Record<string, Action[]> {
    if (!_rolePermissions || Object.keys(_rolePermissions).length === 0) {
        _rolePermissions = loadRolePermissions();
    }
    return _rolePermissions;
}

/** Reset cached permissions (for testing or config reload). */
export function resetPermissions(): void {
    _rolePermissions = null;
}

export function getPermissionsForRole(role: Role): Action[] {
    return getRolePermissions()[role] ?? [];
}

export function getAllowedToolsForRole(role: Role): string[] {
    try {
        return getMcpToolsForRole(role);
    } catch {
        return getRoleConfigs()[role]?.allowedTools ?? [];
    }
}

export function getRoleConfig(role: Role) {
    return getRoleConfigs()[role];
}
