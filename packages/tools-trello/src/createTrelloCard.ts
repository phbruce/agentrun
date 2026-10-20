// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, compact } from "./_api.js";

export const createTrelloCard = tool(
    "create_trello_card",
    "Create a Trello card in a list. Use get_trello_board to find list, label and member ids.",
    {
        listId: z.string().describe("Target list id"),
        name: z.string().describe("Card title"),
        desc: z.string().optional().describe("Description (Markdown)"),
        due: z.string().optional().describe("Due date, ISO 8601 (e.g. 2026-10-31T18:00:00-03:00)"),
        labelIds: z.array(z.string()).optional().describe("Label ids"),
        memberIds: z.array(z.string()).optional().describe("Member ids"),
        position: z.enum(["top", "bottom"]).optional().describe("Position in the list. Default bottom"),
    },
    async (args) => {
        const c = await trelloApi("POST", "/cards", undefined, compact({
            idList: args.listId,
            name: args.name,
            desc: args.desc,
            due: args.due,
            idLabels: args.labelIds?.join(","),
            idMembers: args.memberIds?.join(","),
            pos: args.position,
        }));
        return textResult({ id: c.id, name: c.name, url: c.shortUrl, idList: c.idList });
    },
);
