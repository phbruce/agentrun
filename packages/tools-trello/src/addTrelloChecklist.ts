// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult } from "./_api.js";

export const addTrelloChecklist = tool(
    "add_trello_checklist",
    "Create a checklist on a Trello card, optionally with items.",
    {
        cardId: z.string().describe("Card id or short link"),
        name: z.string().describe("Checklist name"),
        items: z.array(z.string()).optional().describe("Item names, in order"),
    },
    async (args) => {
        const cl = await trelloApi("POST", `/cards/${encodeURIComponent(args.cardId)}/checklists`, undefined, { name: args.name });
        const items = [];
        for (const name of args.items ?? []) {
            const it = await trelloApi("POST", `/checklists/${cl.id}/checkItems`, undefined, { name, pos: "bottom" });
            items.push({ id: it.id, name: it.name, state: it.state });
        }
        return textResult({ id: cl.id, name: cl.name, items });
    },
);
