// SPDX-License-Identifier: AGPL-3.0-only
export interface SecretProvider {
    readonly name: string; // "aws-ssm" | "aws-secretsmanager" | "gcp-secret-manager"
    get(path: string): Promise<string>;
    getMany(paths: string[]): Promise<Map<string, string>>;
}

export interface SecretDeclaration {
    name: string;     // logical name used in tool code: "IUGU_API_KEY"
    provider: string; // "aws-ssm" (default)
    path: string;     // "/agentrun/packs/payments/api-key"
}

export type ResolvedSecrets = Map<string, string>; // name → value
