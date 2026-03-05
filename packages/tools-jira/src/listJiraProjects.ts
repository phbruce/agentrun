// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { jiraApi } from "./_api.js";

export const listJiraProjects = tool(
    "list_jira_projects",
    "List all Jira projects accessible to the bot.",
    {},
    async () => {
        const projects = await jiraApi("GET", "/project");
        const summary = projects.map((p: any) => ({
            key: p.key,
            name: p.name,
            projectTypeKey: p.projectTypeKey,
        }));
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({ count: summary.length, projects: summary }, null, 2),
                },
            ],
        };
    },
);
