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
let _emailMap: Map<string, UserProfile> | null = null;

function ensureLoaded(): { byKey: Map<string, UserProfile>; byEmail: Map<string, UserProfile> } {
    if (!_userMap) {
        _users = loadUsers();
        _userMap = new Map(_users.map((u) => [makeKey(u.externalId, u.source), u]));
        // Build email-only index for cross-channel fallback
        _emailMap = new Map();
        for (const u of _users) {
            // First match wins — source-specific lookup takes priority anyway
            if (!_emailMap.has(u.externalId)) {
                _emailMap.set(u.externalId, u);
            }
        }
    }
    return { byKey: _userMap, byEmail: _emailMap! };
}

/** Reset cached users (for testing or config reload). */
export function resetUserRegistry(): void {
    _users = null;
    _userMap = null;
    _emailMap = null;
}

function makeKey(externalId: string, source: IdentitySource): string {
    return `${source}:${externalId}`;
}

/**
 * Lookup user by source:externalId, falling back to externalId-only match.
 * This allows the same email to work across channels (Slack, GChat, etc.)
 * without duplicating user entries in PlatformConfig.
 */
function findUser(userId: string, source: IdentitySource): UserProfile | null {
    const { byKey, byEmail } = ensureLoaded();
    return byKey.get(makeKey(userId, source)) ?? byEmail.get(userId) ?? null;
}

export function getUserProfile(userId: string, source: IdentitySource): UserProfile | null {
    return findUser(userId, source);
}

export function getRoleForUser(userId: string, source: IdentitySource): Role {
    return findUser(userId, source)?.role ?? "viewer";
}

export function getDisplayName(userId: string, source: IdentitySource): string {
    return findUser(userId, source)?.name ?? "Usuário";
}
