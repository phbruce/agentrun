// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getOrg, githubApi } from "./_api.js";

export const getPrDetails = tool(
    "get_pr_details",
    "Get details of a specific pull request including reviews, mergeable status, and diff stats.",
    {
        repo: z.string().describe("Repository name"),
        prNumber: z.number().describe("PR number")
    },
    async (args) => {
        const [pr, reviews] = await Promise.all([
            githubApi(`/repos/${getOrg()}/${args.repo}/pulls/${args.prNumber}`),
            githubApi(`/repos/${getOrg()}/${args.repo}/pulls/${args.prNumber}/reviews`)
        ]);
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            number: pr.number,
                            title: pr.title,
                            state: pr.state,
                            author: pr.user?.login,
                            mergeable: pr.mergeable,
                            mergeableState: pr.mergeable_state,
                            additions: pr.additions,
                            deletions: pr.deletions,
                            changedFiles: pr.changed_files,
                            base: pr.base?.ref,
                            head: pr.head?.ref,
                            reviews: reviews.map((r: any) => ({
                                user: r.user?.login,
                                state: r.state,
                                submittedAt: r.submitted_at
                            }))
                        },
                        null,
                        2
                    )
                }
            ]
        };
    }
);
