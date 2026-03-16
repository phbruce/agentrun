// SPDX-License-Identifier: AGPL-3.0-only

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { logger } from "@agentrun-ai/core";
import type { CredentialProvider } from "@agentrun-ai/core";

export class StsCredentialProvider implements CredentialProvider {
    private sts: STSClient;
    private roleArnPattern: string;

    constructor(region: string, roleArnPattern: string) {
        this.sts = new STSClient({ region });
        this.roleArnPattern = roleArnPattern;
    }

    async getCredentials(role: string): Promise<unknown> {
        const roleArn = this.roleArnPattern.replace("{{ role }}", role);

        const creds = await this.sts.send(new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: `agentrun-${role}-${Date.now()}`,
            DurationSeconds: 900,
        }));

        logger.info({ role, roleArn }, "STS AssumeRole for credential scoping");

        return {
            accessKeyId: creds.Credentials!.AccessKeyId!,
            secretAccessKey: creds.Credentials!.SecretAccessKey!,
            sessionToken: creds.Credentials!.SessionToken!,
        };
    }
}
