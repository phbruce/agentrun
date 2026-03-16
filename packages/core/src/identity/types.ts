// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentitySource, Role } from "../rbac/types.js";

export interface ResolvedIdentity {
    userId: string;
    source: IdentitySource;
    name: string;
    role: Role;
    /** Opaque credentials resolved by CredentialProvider. Shape is provider-specific. */
    credentials: unknown;
    packs: string[];
}

export interface IdentityProvider {
    resolve(externalId: string, source: IdentitySource): Promise<ResolvedIdentity>;
}
