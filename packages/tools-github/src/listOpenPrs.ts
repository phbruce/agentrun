// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getOrg, getAllowedRepos, githubApi } from "./_api.js";

export const listOpenPrs = tool(
    "list_open_prs",
    "List open pull requests for a repository.",
    {
        repo: z.string().describe("Repository name")
    },
    async (args) => {
        if (getAllowedRepos().length > 0 && !getAllowedRepos().includes(args.repo)) {
            return { content: [{ type: "text" as const, text: `Repo not allowed: ${args.repo}` }] };
        }
        const prs = await githubApi(`/repos/${getOrg()}/${args.repo}/pulls?state=open&per_page=30`);
        const summary = prs.map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            labels: pr.labels?.map((l: any) => l.name),
            draft: pr.draft
        }));
        return {
            content: [
                { type: "text" as const, text: JSON.stringify({ count: summary.length, prs: summary }, null, 2) }
            ]
        };
    }
);
