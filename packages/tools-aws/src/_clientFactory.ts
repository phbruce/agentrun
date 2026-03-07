// SPDX-License-Identifier: AGPL-3.0-only

import { LambdaClient } from "@aws-sdk/client-lambda";
import { EKSClient } from "@aws-sdk/client-eks";
import { RDSClient } from "@aws-sdk/client-rds";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "@agentrun-ai/core";
import { REGION } from "./_clients.js";
import type { ResolvedIdentity } from "@agentrun-ai/core";

export interface AwsClients {
    lambdaClient: LambdaClient;
    eksClient: EKSClient;
    rdsClient: RDSClient;
    cwlClient: CloudWatchLogsClient;
    sqsClient: SQSClient;
}

interface StsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}

function isStsCredentials(creds: unknown): creds is StsCredentials {
    return (
        typeof creds === "object" && creds !== null &&
        "accessKeyId" in creds && "secretAccessKey" in creds && "sessionToken" in creds
    );
}

export async function createClientsForIdentity(identity: ResolvedIdentity): Promise<AwsClients> {
    let credentials: StsCredentials;

    if (isStsCredentials(identity.credentials)) {
        // Already-resolved STS temporary credentials (from CredentialProvider)
        credentials = identity.credentials;
        logger.info({ role: identity.role }, "Using pre-resolved credentials for identity");
    } else {
        // Fallback: no credentials resolved — use default credentials
        logger.info({ role: identity.role }, "No scoped credentials, using default AWS credentials");
        return {
            lambdaClient: new LambdaClient({ region: REGION }),
            eksClient: new EKSClient({ region: REGION }),
            rdsClient: new RDSClient({ region: REGION }),
            cwlClient: new CloudWatchLogsClient({ region: REGION }),
            sqsClient: new SQSClient({ region: REGION }),
        };
    }

    return {
        lambdaClient: new LambdaClient({ region: REGION, credentials }),
        eksClient: new EKSClient({ region: REGION, credentials }),
        rdsClient: new RDSClient({ region: REGION, credentials }),
        cwlClient: new CloudWatchLogsClient({ region: REGION, credentials }),
        sqsClient: new SQSClient({ region: REGION, credentials }),
    };
}
