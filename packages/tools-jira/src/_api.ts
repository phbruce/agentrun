// SPDX-License-Identifier: AGPL-3.0-only

import { logger, PlatformRegistry } from "@agentrun-oss/core";

function getBaseUrl(): string {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const jiraSource = registry.config.spec.identity.sources.find((s: any) => s.type === "jira");
            if (jiraSource?.org) {
                return `https://${jiraSource.org}.atlassian.net/rest/api/3`;
            }
        }
    } catch { /* not configured */ }

    return process.env.JIRA_BASE_URL ?? "";
}

function getJiraOrg(): string {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const jiraSource = registry.config.spec.identity.sources.find((s: any) => s.type === "jira");
            if (jiraSource?.org) {
                return jiraSource.org;
            }
        }
    } catch { /* not configured */ }

    return process.env.JIRA_ORG ?? "";
}

export async function jiraApi(method: string, path: string, body?: any): Promise<any> {
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;

    if (!email || !token) {
        throw new Error("JIRA_EMAIL or JIRA_API_TOKEN not configured");
    }

    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const baseUrl = getBaseUrl();

    if (!baseUrl) {
        throw new Error("JIRA_BASE_URL not configured. Set JIRA_BASE_URL or configure the Jira identity source.");
    }

    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
        const text = await res.text();
        logger.error({ status: res.status, method, path, body: text }, "Jira API error");
        throw new Error(`Jira API ${res.status}: ${text}`);
    }

    return res.json();
}

export function toAdf(text: string) {
    return {
        type: "doc",
        version: 1,
        content: [
            {
                type: "paragraph",
                content: [{ type: "text", text }],
            },
        ],
    };
}

export function getBrowseUrl(issueKey: string): string {
    const org = getJiraOrg();
    if (org) {
        return `https://${org}.atlassian.net/browse/${issueKey}`;
    }
    const baseUrl = getBaseUrl();
    // Derive browse URL from REST API base URL
    const browseBase = baseUrl.replace("/rest/api/3", "");
    return `${browseBase}/browse/${issueKey}`;
}
