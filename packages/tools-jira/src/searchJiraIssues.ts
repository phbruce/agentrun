// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { jiraApi } from "./_api.js";

export const searchJiraIssues = tool(
    "search_jira_issues",
    "Search Jira issues using JQL.",
    {
        jql: z.string().describe("JQL query string"),
        maxResults: z.number().min(1).max(50).default(10).describe("Max results (default 10, max 50)"),
    },
    async (args) => {
        const data = await jiraApi("POST", "/search/jql", {
            jql: args.jql,
            maxResults: args.maxResults,
            fields: ["summary", "status", "assignee", "priority", "issuetype", "created", "updated"],
        });
        const issues = data.issues.map((i: any) => ({
            key: i.key,
            summary: i.fields.summary,
            status: i.fields.status?.name,
            assignee: i.fields.assignee?.displayName ?? "Unassigned",
            priority: i.fields.priority?.name,
            type: i.fields.issuetype?.name,
            created: i.fields.created,
            updated: i.fields.updated,
        }));
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({ total: data.total, count: issues.length, issues }, null, 2),
                },
            ],
        };
    },
);
