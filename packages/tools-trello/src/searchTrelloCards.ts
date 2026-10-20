// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, summarizeCard, CARD_FIELDS } from "./_api.js";

export const searchTrelloCards = tool(
    "search_trello_cards",
    "Search Trello cards by text (Trello search syntax, e.g. 'deploy label:bug is:open'). Optionally limit to boards.",
    {
        query: z.string().describe("Search text, supports Trello operators (board:, list:, label:, member:, is:open, due:week)"),
        boardIds: z.array(z.string()).optional().describe("Restrict to these board ids"),
        limit: z.number().int().min(1).max(100).optional().describe("Max cards (default 25, max 100)"),
    },
    async (args) => {
        const r = await trelloApi("GET", "/search", {
            query: args.query,
            modelTypes: "cards",
            cards_limit: args.limit ?? 25,
            card_fields: CARD_FIELDS,
            idBoards: args.boardIds?.length ? args.boardIds.join(",") : undefined,
            partial: true,
        });
        const cards = r.cards ?? [];
        return textResult({ total: cards.length, cards: cards.map(summarizeCard) });
    },
);
