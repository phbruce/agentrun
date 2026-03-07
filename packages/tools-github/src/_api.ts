// SPDX-License-Identifier: AGPL-3.0-only

import { logger, PlatformRegistry, getInstallationToken } from "@agentrun-ai/core";

function getGitHubConfig(): { org: string; allowedRepos: string[] } {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const env = registry.config.spec.environment;
            return {
                org: registry.config.spec.identity.sources.find((s: any) => s.type === "github")?.org
                    ?? process.env.GITHUB_ORG ?? "",
                allowedRepos: env.repos.map((r: any) => r.name),
            };
        }
    } catch { /* not configured */ }

    const org = process.env.GITHUB_ORG ?? "";
    const repos = process.env.GITHUB_REPOS?.split(",").map((r) => r.trim()).filter(Boolean) ?? [];

    return { org, allowedRepos: repos };
}

export function getOrg(): string {
    return getGitHubConfig().org;
}

export function getAllowedRepos(): string[] {
    return getGitHubConfig().allowedRepos;
}

export async function githubApi(path: string): Promise<any> {
    const token = await getInstallationToken();

    const res = await fetch(`https://api.github.com${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });
    if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, path, body }, "GitHub API error");
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
}
