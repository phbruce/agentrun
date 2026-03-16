// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { jiraApi, toAdf, getBrowseUrl } from "./_api.js";

export const createJiraIssue = tool(
    "create_jira_issue",
    "Create a new Jira issue in a project.",
    {
        project: z.string().describe("Project key (e.g. PROJ)"),
        issueType: z.string().describe("Issue type (e.g. Task, Bug, Story)"),
        summary: z.string().describe("Issue summary/title"),
        description: z.string().optional().describe("Issue description (plain text)"),
    },
    async (args) => {
        const fields: any = {
            project: { key: args.project },
            issuetype: { name: args.issueType },
            summary: args.summary,
        };
        if (args.description) {
            fields.description = toAdf(args.description);
        }
        const result = await jiraApi("POST", "/issue", { fields });
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            key: result.key,
                            self: result.self,
                            url: getBrowseUrl(result.key),
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);
