// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult } from "./_api.js";

export const addTrelloComment = tool(
    "add_trello_comment",
    "Add a comment to a Trello card.",
    {
        cardId: z.string().describe("Card id or short link"),
        text: z.string().describe("Comment text (Markdown)"),
    },
    async (args) => {
        const a = await trelloApi("POST", `/cards/${encodeURIComponent(args.cardId)}/actions/comments`, undefined, { text: args.text });
        return textResult({ id: a.id, date: a.date });
    },
);
