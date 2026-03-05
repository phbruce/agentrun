// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getOrg, githubApi } from "./_api.js";

export const recentCommits = tool(
    "recent_commits",
    "Get recent commits on a branch of a repository.",
    {
        repo: z.string().describe("Repository name"),
        branch: z.string().default("main").describe("Branch name (default: main)"),
        count: z.number().default(10).describe("Number of commits to fetch (default: 10, max: 30)")
    },
    async (args) => {
        const perPage = Math.min(args.count, 30);
        const commits = await githubApi(
            `/repos/${getOrg()}/${args.repo}/commits?sha=${args.branch}&per_page=${perPage}`
        );
        const summary = commits.map((c: any) => ({
            sha: c.sha?.slice(0, 7),
            message: c.commit?.message?.split("\n")[0],
            author: c.commit?.author?.name,
            date: c.commit?.author?.date
        }));
        return {
            content: [{ type: "text" as const, text: JSON.stringify({ commits: summary }, null, 2) }]
        };
    }
);
