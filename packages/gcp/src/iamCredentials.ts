// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";
import type { CredentialProvider } from "@agentrun-ai/core";

/**
 * GCP IAM credential provider via service account impersonation.
 *
 * Uses google-auth-library to generate access tokens for impersonated
 * service accounts following the pattern:
 *   agentrun-{role}@{projectId}.iam.gserviceaccount.com
 *
 * @param projectId      - GCP project ID
 * @param saEmailPattern - SA email pattern with {{ role }} placeholder
 */
export class GcpIamCredentialProvider implements CredentialProvider {
    private Impersonated: any = null;
    private GoogleAuth: any = null;

    constructor(
        private readonly projectId: string,
        private readonly saEmailPattern: string = "agentrun-{{ role }}@{{ projectId }}.iam.gserviceaccount.com",
    ) {}

    private async ensureClasses(): Promise<void> {
        if (this.Impersonated) return;
        const authLib = await import("google-auth-library");
        this.Impersonated = authLib.Impersonated;
        this.GoogleAuth = authLib.GoogleAuth;
    }

    async getCredentials(role: string): Promise<unknown> {
        await this.ensureClasses();

        const targetPrincipal = this.saEmailPattern
            .replace("{{ role }}", role)
            .replace("{{ projectId }}", this.projectId);

        const auth = new this.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });

        const sourceClient = await auth.getClient();

        const impersonatedClient = new this.Impersonated({
            sourceClient,
            targetPrincipal,
            lifetime: 900,
            delegates: [],
            targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });

        const tokenResponse = await impersonatedClient.getAccessToken();

        logger.info({ role, targetPrincipal }, "GCP IAM impersonation for credential scoping");

        return {
            accessToken: tokenResponse.token,
            expiry: tokenResponse.expirationTime,
        };
    }
}
