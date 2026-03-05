// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentitySource, Role, UserProfile } from "./types.js";
import { PlatformRegistry } from "../platform/registry.js";

function loadUsers(): UserProfile[] {
    const registry = PlatformRegistry.instance();
    if (!registry.isConfigured) return [];
    return registry.config.spec.users.map((u) => ({
        externalId: u.externalId,
        source: u.source as IdentitySource,
        name: u.name,
        role: u.role as Role,
        packs: u.packs,
    }));
}

let _users: UserProfile[] | null = null;
let _userMap: Map<string, UserProfile> | null = null;

function ensureLoaded(): Map<string, UserProfile> {
    if (!_userMap) {
        _users = loadUsers();
        _userMap = new Map(_users.map((u) => [makeKey(u.externalId, u.source), u]));
    }
    return _userMap;
}

/** Reset cached users (for testing or config reload). */
export function resetUserRegistry(): void {
    _users = null;
    _userMap = null;
}

function makeKey(externalId: string, source: IdentitySource): string {
    return `${source}:${externalId}`;
}

export function getUserProfile(userId: string, source: IdentitySource = "slack"): UserProfile | null {
    return ensureLoaded().get(makeKey(userId, source)) ?? null;
}

export function getRoleForUser(userId: string, source: IdentitySource = "slack"): Role {
    return ensureLoaded().get(makeKey(userId, source))?.role ?? "viewer";
}

export function getDisplayName(userId: string, source: IdentitySource = "slack"): string {
    return ensureLoaded().get(makeKey(userId, source))?.name ?? "Usuário";
}
