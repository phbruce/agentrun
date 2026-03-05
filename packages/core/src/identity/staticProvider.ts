// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentityProvider, ResolvedIdentity } from "./types.js";
import type { IdentitySource } from "../rbac/types.js";
import { getUserProfile } from "../rbac/userRegistry.js";
import { PlatformRegistry } from "../platform/registry.js";
import { logger } from "../logger.js";

export class StaticIdentityProvider implements IdentityProvider {
    async resolve(externalId: string, source: IdentitySource = "slack"): Promise<ResolvedIdentity> {
        const profile = getUserProfile(externalId, source);
        const role = profile?.role ?? "viewer";

        let credentials: unknown = null;
        try {
            const registry = PlatformRegistry.instance();
            if (registry.isConfigured) {
                credentials = await registry.credentials.getCredentials(role);
            }
        } catch (err: any) {
            logger.warn({ err: err.message, role, externalId }, "CredentialProvider.getCredentials failed");
        }

        return {
            userId: externalId,
            source,
            name: profile?.name ?? "Usuário",
            role,
            credentials,
            packs: profile?.packs ?? ["core"],
        };
    }
}
