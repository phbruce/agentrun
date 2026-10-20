// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult, compact } from "./_api.js";

export const createTrelloList = tool(
    "create_trello_list",
    "Create a list on a Trello board.",
    {
        boardId: z.string().describe("Board id"),
        name: z.string().describe("List name"),
        position: z.enum(["top", "bottom"]).optional().describe("Position on the board. Default bottom"),
    },
    async (args) => {
        const l = await trelloApi("POST", "/lists", undefined, compact({
            idBoard: args.boardId,
            name: args.name,
            pos: args.position ?? "bottom",
        }));
        return textResult({ id: l.id, name: l.name, idBoard: l.idBoard });
    },
);
