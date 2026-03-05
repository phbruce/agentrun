// SPDX-License-Identifier: AGPL-3.0-only
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import type { SecretProvider } from "./types.js";

export class SsmSecretProvider implements SecretProvider {
    readonly name = "aws-ssm";
    private client: SSMClient;

    constructor(region = "us-east-1") {
        this.client = new SSMClient({ region });
    }

    async get(path: string): Promise<string> {
        const result = await this.getMany([path]);
        const value = result.get(path);
        if (value === undefined) {
            throw new Error(`SSM parameter not found: ${path}`);
        }
        return value;
    }

    async getMany(paths: string[]): Promise<Map<string, string>> {
        if (paths.length === 0) return new Map();

        const results = new Map<string, string>();

        // SSM GetParameters supports up to 10 params per call
        for (let i = 0; i < paths.length; i += 10) {
            const batch = paths.slice(i, i + 10);
            const resp = await this.client.send(
                new GetParametersCommand({
                    Names: batch,
                    WithDecryption: true,
                })
            );
            for (const p of resp.Parameters ?? []) {
                if (p.Name && p.Value) {
                    results.set(p.Name, p.Value);
                }
            }
        }

        return results;
    }
}
