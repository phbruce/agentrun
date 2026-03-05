// SPDX-License-Identifier: AGPL-3.0-only

import { LambdaClient } from "@aws-sdk/client-lambda";
import { EKSClient } from "@aws-sdk/client-eks";
import { RDSClient } from "@aws-sdk/client-rds";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { SQSClient } from "@aws-sdk/client-sqs";

export const REGION = process.env.AWS_REGION ?? "us-east-1";

export const lambdaClient = new LambdaClient({ region: REGION });
export const eksClient = new EKSClient({ region: REGION });
export const rdsClient = new RDSClient({ region: REGION });
export const cwlClient = new CloudWatchLogsClient({ region: REGION });
export const sqsClient = new SQSClient({ region: REGION });

export function redactEnvVars(envVars: Record<string, string> | undefined): Record<string, string> {
    if (!envVars) return {};
    const SENSITIVE = ["SECRET", "PASSWORD", "TOKEN", "KEY", "CREDENTIALS", "ARN"];
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(envVars)) {
        redacted[k] = SENSITIVE.some((s) => k.toUpperCase().includes(s)) ? "***REDACTED***" : v;
    }
    return redacted;
}
