// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { jiraApi } from "./_api.js";

export const transitionJiraIssue = tool(
    "transition_jira_issue",
    "Transition a Jira issue to a new status (e.g. 'In Progress', 'Done').",
    {
        issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
        transitionName: z.string().describe("Target transition name (e.g. 'In Progress', 'Done')"),
    },
    async (args) => {
        const { transitions } = await jiraApi("GET", `/issue/${args.issueKey}/transitions`);
        const match = transitions.find(
            (t: any) => t.name.toLowerCase() === args.transitionName.toLowerCase(),
        );
        if (!match) {
            const available = transitions.map((t: any) => t.name).join(", ");
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Transition "${args.transitionName}" not found. Available: ${available}`,
                    },
                ],
            };
        }
        await jiraApi("POST", `/issue/${args.issueKey}/transitions`, {
            transition: { id: match.id },
        });
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            issueKey: args.issueKey,
                            transition: match.name,
                            newStatus: match.to?.name ?? match.name,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);
