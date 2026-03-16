// SPDX-License-Identifier: AGPL-3.0-only
/** Role is now extensible — any string. Well-known defaults listed for convenience. */
export type Role = string;

/** Well-known roles (not exhaustive — config can define any role). */
export const WELL_KNOWN_ROLES = ["executive", "tech_lead", "developer", "platform", "viewer"] as const;

export type Action = string;

/** Well-known actions. */
export const WELL_KNOWN_ACTIONS = ["infra:query", "infra:write", "infra:admin"] as const;

export type IdentitySource = string;

export interface UserProfile {
    externalId: string;
    source: IdentitySource;
    name: string;
    role: Role;
    packs?: string[];
}

export interface RoleConfig {
    allowedTools: string[];
    allowedUseCases: string[];
    persona: string;
    capabilities: string;
    maxTurns: number;
    maxBudgetUsd: number;
}
