// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, summarizeCard, CARD_FIELDS } from "./_api.js";

export const listTrelloCards = tool(
    "list_trello_cards",
    "List cards of a Trello board or of a single list. Pass listId to narrow to one list.",
    {
        boardId: z.string().optional().describe("Board id or short link"),
        listId: z.string().optional().describe("List id (takes precedence over boardId)"),
        includeClosed: z.boolean().optional().describe("Include archived cards. Default false"),
    },
    async (args) => {
        if (!args.listId && !args.boardId) {
            throw new Error("Pass boardId or listId");
        }
        const path = args.listId
            ? `/lists/${encodeURIComponent(args.listId)}/cards`
            : `/boards/${encodeURIComponent(args.boardId!)}/cards/${args.includeClosed ? "all" : "open"}`;
        const cards = await trelloApi("GET", path, { fields: CARD_FIELDS });
        const filtered = args.listId && !args.includeClosed ? cards.filter((c: any) => !c.closed) : cards;
        return textResult({ total: filtered.length, cards: filtered.map(summarizeCard) });
    },
);
