// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { jiraApi, toAdf } from "./_api.js";

export const addJiraComment = tool(
    "add_jira_comment",
    "Add a comment to a Jira issue.",
    {
        issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
        comment: z.string().describe("Comment text"),
    },
    async (args) => {
        const result = await jiraApi("POST", `/issue/${args.issueKey}/comment`, {
            body: toAdf(args.comment),
        });
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({ id: result.id, created: result.created }, null, 2),
                },
            ],
        };
    },
);
