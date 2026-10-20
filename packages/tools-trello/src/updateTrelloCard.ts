// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, compact, summarizeCard } from "./_api.js";

export const updateTrelloCard = tool(
    "update_trello_card",
    "Update a Trello card: rename, edit description, move to another list or board, set or clear due date, mark due complete, set labels or members, archive or restore. Only the fields passed change. labelIds/memberIds replace the current set.",
    {
        cardId: z.string().describe("Card id or short link"),
        name: z.string().optional().describe("New title"),
        desc: z.string().optional().describe("New description (Markdown)"),
        listId: z.string().optional().describe("Move to this list id"),
        boardId: z.string().optional().describe("Move to this board id (pass listId of that board too)"),
        position: z.enum(["top", "bottom"]).optional().describe("Position in the list"),
        due: z.string().nullable().optional().describe("Due date ISO 8601; null clears it"),
        dueComplete: z.boolean().optional().describe("Mark the due date complete or not"),
        labelIds: z.array(z.string()).optional().describe("Replace labels with these ids ([] clears)"),
        memberIds: z.array(z.string()).optional().describe("Replace members with these ids ([] clears)"),
        archived: z.boolean().optional().describe("true archives the card, false restores it"),
    },
    async (args) => {
        const body = compact({
            name: args.name,
            desc: args.desc,
            idList: args.listId,
            idBoard: args.boardId,
            pos: args.position,
            due: args.due === null ? "" : args.due,
            dueComplete: args.dueComplete,
            idLabels: args.labelIds?.join(","),
            idMembers: args.memberIds?.join(","),
            closed: args.archived,
        });
        if (Object.keys(body).length === 0) {
            throw new Error("Nothing to update: pass at least one field");
        }
        const c = await trelloApi("PUT", `/cards/${encodeURIComponent(args.cardId)}`, undefined, body);
        return textResult(summarizeCard(c));
    },
);
