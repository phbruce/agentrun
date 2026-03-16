// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { jiraApi } from "./_api.js";

export const getJiraIssue = tool(
    "get_jira_issue",
    "Get full details of a Jira issue including comments and available transitions.",
    {
        issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
    },
    async (args) => {
        const [issue, comments] = await Promise.all([
            jiraApi("GET", `/issue/${args.issueKey}?expand=transitions`),
            jiraApi("GET", `/issue/${args.issueKey}/comment`),
        ]);
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            key: issue.key,
                            summary: issue.fields.summary,
                            status: issue.fields.status?.name,
                            assignee: issue.fields.assignee?.displayName ?? "Unassigned",
                            reporter: issue.fields.reporter?.displayName,
                            priority: issue.fields.priority?.name,
                            type: issue.fields.issuetype?.name,
                            created: issue.fields.created,
                            updated: issue.fields.updated,
                            description: issue.fields.description,
                            labels: issue.fields.labels,
                            transitions: issue.transitions?.map((t: any) => ({
                                id: t.id,
                                name: t.name,
                                to: t.to?.name,
                            })),
                            comments: comments.comments?.map((c: any) => ({
                                author: c.author?.displayName,
                                created: c.created,
                                body: c.body,
                            })),
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);
