// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, compact } from "./_api.js";

export const updateTrelloChecklistItem = tool(
    "update_trello_checklist_item",
    "Check, uncheck or rename a checklist item on a Trello card. Item ids come from get_trello_card.",
    {
        cardId: z.string().describe("Card id or short link"),
        itemId: z.string().describe("Checklist item id"),
        complete: z.boolean().optional().describe("true checks the item, false unchecks it"),
        name: z.string().optional().describe("New item text"),
    },
    async (args) => {
        const body = compact({
            state: args.complete === undefined ? undefined : args.complete ? "complete" : "incomplete",
            name: args.name,
        });
        if (Object.keys(body).length === 0) {
            throw new Error("Nothing to update: pass complete or name");
        }
        const it = await trelloApi("PUT", `/cards/${encodeURIComponent(args.cardId)}/checkItem/${encodeURIComponent(args.itemId)}`, undefined, body);
        return textResult({ id: it.id, name: it.name, state: it.state });
    },
);
