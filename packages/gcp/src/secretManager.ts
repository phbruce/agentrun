// SPDX-License-Identifier: AGPL-3.0-only

import type { BootstrapSecretProvider } from "@agentrun-ai/core";

/**
 * Google Cloud Secret Manager-backed BootstrapSecretProvider.
 *
 * Fetches the latest version of a secret and parses its JSON payload.
 *
 * @param projectId - GCP project ID
 */
export class GcpSecretProvider implements BootstrapSecretProvider {
    private client: any = null;
    private projectId: string;

    constructor(projectId: string) {
        this.projectId = projectId;
    }

    private async ensureClient(): Promise<any> {
        if (this.client) return this.client;
        const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
        this.client = new SecretManagerServiceClient();
        return this.client;
    }

    async getSecretValue(secretName: string): Promise<Record<string, string>> {
        const client = await this.ensureClient();

        // Support both full resource name and short name
        const name = secretName.startsWith("projects/")
            ? secretName
            : `projects/${this.projectId}/secrets/${secretName}/versions/latest`;

        const [version] = await client.accessSecretVersion({ name });

        const payload = version.payload?.data;
        if (!payload) return {};

        const secretString = typeof payload === "string"
            ? payload
            : Buffer.from(payload).toString("utf-8");

        return JSON.parse(secretString);
    }
}
