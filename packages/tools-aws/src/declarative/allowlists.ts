// SPDX-License-Identifier: AGPL-3.0-only

// ---------------------------------------------------------------------------
// Server-side allowlists for declarative tools.
// These define the security boundary for which AWS actions, HTTP URLs,
// and Lambda functions can be invoked via declarative tool definitions.
// ---------------------------------------------------------------------------

/** AWS SDK — only read-only / observability actions. */
export const AWS_SERVICE_ALLOWLIST: Record<string, string[]> = {
    S3: ["ListBuckets", "GetBucketLocation", "ListObjectsV2", "HeadObject"],
    Lambda: ["ListFunctions", "GetFunction", "GetFunctionConfiguration"],
    EKS: ["DescribeCluster", "ListNodegroups", "DescribeNodegroup"],
    RDS: ["DescribeDBClusters", "DescribeDBProxies", "DescribeDBInstances"],
    CloudWatchLogs: ["FilterLogEvents", "DescribeLogGroups"],
    SQS: ["ListQueues", "GetQueueAttributes"],
    CostExplorer: ["GetCostAndUsage", "GetCostForecast"],
    CloudWatch: ["GetMetricData", "ListMetrics", "GetMetricStatistics"],
    DynamoDB: ["DescribeTable", "ListTables"],
    SecretsManager: ["DescribeSecret", "ListSecrets"],
    SSM: ["GetParameter", "GetParameters", "DescribeParameters"],
};

/**
 * HTTP — SSRF protection, only known external APIs.
 * Override via AGENTRUN_HTTP_ALLOWLIST env var (comma-separated regex patterns).
 */
export const HTTP_URL_ALLOWLIST: RegExp[] = (() => {
    const envPatterns = process.env.AGENTRUN_HTTP_ALLOWLIST;
    if (envPatterns) {
        return envPatterns.split(",").map((p) => new RegExp(p.trim()));
    }
    return [
        /^https:\/\/api\.pagerduty\.com\//,
        /^https:\/\/api\.datadoghq\.com\//,
        /^https:\/\/api\.sendgrid\.com\//,
    ];
})();

/**
 * Lambda — only functions matching allowed prefixes.
 * Override via AGENTRUN_LAMBDA_PREFIX env var (comma-separated prefixes).
 */
export const LAMBDA_NAME_ALLOWLIST: RegExp[] = (() => {
    const envPrefixes = process.env.AGENTRUN_LAMBDA_PREFIX;
    if (envPrefixes) {
        return envPrefixes.split(",").map((p) => new RegExp(`^${p.trim()}`));
    }
    return [
        /^[a-z]+-[a-z]+-/,  // Generic pattern: {project}-{env}-
    ];
})();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SecurityError";
    }
}

export function validateAwsSdkAction(service: string, action: string): void {
    const allowed = AWS_SERVICE_ALLOWLIST[service];
    if (!allowed) {
        throw new SecurityError(
            `AWS service "${service}" is not in the allowlist. Allowed: ${Object.keys(AWS_SERVICE_ALLOWLIST).join(", ")}`,
        );
    }
    if (!allowed.includes(action)) {
        throw new SecurityError(
            `AWS action "${service}.${action}" is not in the allowlist. Allowed for ${service}: ${allowed.join(", ")}`,
        );
    }
}

export function validateHttpUrl(url: string): void {
    const match = HTTP_URL_ALLOWLIST.some((re) => re.test(url));
    if (!match) {
        throw new SecurityError(
            `URL "${url}" is not in the HTTP allowlist. Only known external APIs are permitted.`,
        );
    }
}

export function validateLambdaName(functionName: string): void {
    const match = LAMBDA_NAME_ALLOWLIST.some((re) => re.test(functionName));
    if (!match) {
        throw new SecurityError(
            `Lambda "${functionName}" is not in the allowlist. Configure AGENTRUN_LAMBDA_PREFIX to allow your function prefixes.`,
        );
    }
}
