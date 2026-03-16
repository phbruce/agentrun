// SPDX-License-Identifier: AGPL-3.0-only

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { BootstrapSecretProvider } from "@agentrun-ai/core";

export class SmBootstrapProvider implements BootstrapSecretProvider {
    private client: SecretsManagerClient;

    constructor() {
        this.client = new SecretsManagerClient({});
    }

    async getSecretValue(secretArn: string): Promise<Record<string, string>> {
        const res = await this.client.send(new GetSecretValueCommand({
            SecretId: secretArn,
        }));

        if (!res.SecretString) return {};
        return JSON.parse(res.SecretString);
    }
}
