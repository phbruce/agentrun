// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "crypto";
import type { IdentityProvider, ResolvedIdentity } from "./types.js";
import type { IdentitySource, Role } from "../rbac/types.js";
import { getUserProfile } from "../rbac/userRegistry.js";
import { PlatformRegistry } from "../platform/registry.js";
import { logger } from "../logger.js";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
    identity: ResolvedIdentity;
    expiresAt: number;
}

const identityCache = new Map<string, CacheEntry>();

function cacheKey(token: string): string {
    return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

async function githubFetch(path: string, token: string): Promise<Response> {
    return fetch(`https://api.github.com${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
}

/** Read GitHub identity config from platform config. */
function getGitHubConfig(): { org: string; teamRoleMapping: Record<string, string>; defaultRole: string } {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const ghSource = registry.config.spec.identity.sources.find((s) => s.type === "github");
            if (ghSource) {
                return {
                    org: ghSource.org ?? process.env.AGENTRUN_GITHUB_ORG ?? "my-org",
                    teamRoleMapping: ghSource.teamRoleMapping ?? { leaders: "tech_lead", "squad-*": "developer" },
                    defaultRole: ghSource.defaultRole ?? "viewer",
                };
            }
        }
    } catch { /* fall through */ }

    return {
        org: process.env.AGENTRUN_GITHUB_ORG ?? "my-org",
        teamRoleMapping: { leaders: "tech_lead", "squad-*": "developer" },
        defaultRole: "viewer",
    };
}

export class GitHubTokenProvider implements IdentityProvider {
    async resolve(token: string, _source: IdentitySource): Promise<ResolvedIdentity> {
        // Check cache
        const key = cacheKey(token);
        const cached = identityCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.identity;
        }

        const ghConfig = getGitHubConfig();

        // 1. Get GitHub user
        const userRes = await githubFetch("/user", token);
        if (!userRes.ok) {
            logger.warn({ status: userRes.status }, "GitHub /user failed");
            throw new Error(`GitHub token invalid (status ${userRes.status})`);
        }
        const user = await userRes.json() as { login: string; name: string | null; id: number };

        // 2. Validate org membership
        const orgRes = await githubFetch(`/orgs/${ghConfig.org}/members/${user.login}`, token);
        if (orgRes.status !== 204) {
            logger.warn({ login: user.login, status: orgRes.status }, "User not in org");
            throw new Error(`User ${user.login} is not a member of ${ghConfig.org}`);
        }

        // 3. Get user's teams in the org
        const teamsRes = await githubFetch(`/user/teams`, token);
        const teams: string[] = [];
        if (teamsRes.ok) {
            const allTeams = await teamsRes.json() as Array<{ slug: string; organization: { login: string } }>;
            for (const team of allTeams) {
                if (team.organization.login === ghConfig.org) {
                    teams.push(team.slug);
                }
            }
        }

        // 4. Resolve role: check static registry first, then derive from teams
        const profile = getUserProfile(user.login, "github");
        const role: Role = profile?.role ?? deriveRoleFromTeams(teams, ghConfig.teamRoleMapping, ghConfig.defaultRole);

        // 5. Resolve packs: core + team-based packs
        const packs = ["core", ...teams.map(t => `squads/${t}`)];
        if (profile?.packs) {
            for (const p of profile.packs) {
                if (!packs.includes(p)) packs.push(p);
            }
        }

        // 6. Resolve credentials via CredentialProvider
        let credentials: unknown = null;
        try {
            const registry = PlatformRegistry.instance();
            if (registry.isConfigured) {
                credentials = await registry.credentials.getCredentials(role);
            }
        } catch (err: any) {
            logger.warn({ err: err.message, role }, "CredentialProvider.getCredentials failed in GitHubTokenProvider");
        }

        const identity: ResolvedIdentity = {
            userId: user.login,
            source: "github",
            name: user.name ?? profile?.name ?? user.login,
            role,
            credentials,
            packs,
        };

        // Cache it
        identityCache.set(key, { identity, expiresAt: Date.now() + CACHE_TTL_MS });

        logger.info(
            { userId: identity.userId, role, teams, packs },
            "GitHub identity resolved",
        );

        return identity;
    }
}

function deriveRoleFromTeams(
    teams: string[],
    teamRoleMapping: Record<string, string>,
    defaultRole: string,
): Role {
    for (const [teamPattern, role] of Object.entries(teamRoleMapping)) {
        if (teamPattern.endsWith("*")) {
            const prefix = teamPattern.slice(0, -1);
            if (teams.some(t => t.startsWith(prefix))) return role;
        } else {
            if (teams.includes(teamPattern)) return role;
        }
    }
    return defaultRole;
}
