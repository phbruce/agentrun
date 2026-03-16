// SPDX-License-Identifier: AGPL-3.0-only

export const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "";

let _clusterManagerClient: any;
export function clusterManagerClient() {
    if (!_clusterManagerClient) {
        // Lazy import to avoid loading heavy SDK at module level
        const { ClusterManagerClient } = require("@google-cloud/container");
        _clusterManagerClient = new ClusterManagerClient();
    }
    return _clusterManagerClient;
}

let _sqlAdminClient: any;
export function sqlAdminClient() {
    if (!_sqlAdminClient) {
        const { SqlInstancesServiceClient } = require("@google-cloud/sql");
        _sqlAdminClient = new SqlInstancesServiceClient();
    }
    return _sqlAdminClient;
}

let _functionsClient: any;
export function functionsClient() {
    if (!_functionsClient) {
        const { CloudFunctionsServiceClient } = require("@google-cloud/functions");
        _functionsClient = new CloudFunctionsServiceClient();
    }
    return _functionsClient;
}

let _loggingClient: any;
export function loggingClient() {
    if (!_loggingClient) {
        const { Logging } = require("@google-cloud/logging");
        _loggingClient = new Logging({ projectId });
    }
    return _loggingClient;
}

let _pubsubClient: any;
export function pubsubClient() {
    if (!_pubsubClient) {
        const { PubSub } = require("@google-cloud/pubsub");
        _pubsubClient = new PubSub({ projectId });
    }
    return _pubsubClient;
}

export function redactEnvVars(envVars: Record<string, string> | undefined): Record<string, string> {
    if (!envVars) return {};
    const SENSITIVE = ["SECRET", "PASSWORD", "TOKEN", "KEY", "CREDENTIALS", "ARN"];
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(envVars)) {
        redacted[k] = SENSITIVE.some((s) => k.toUpperCase().includes(s)) ? "***REDACTED***" : v;
    }
    return redacted;
}
