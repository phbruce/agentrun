// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult } from "./_api.js";

export const getTrelloBoard = tool(
    "get_trello_board",
    "Get a Trello board with its open lists, labels and members. Use it to find list, label and member ids before creating or moving cards.",
    {
        boardId: z.string().describe("Board id or short link (from the board URL)"),
    },
    async (args) => {
        const b = await trelloApi("GET", `/boards/${encodeURIComponent(args.boardId)}`, {
            fields: "name,desc,closed,shortUrl",
            lists: "open",
            list_fields: "name,pos,closed",
            labels: "all",
            label_fields: "name,color",
            members: "all",
            member_fields: "fullName,username",
        });
        return textResult({
            id: b.id,
            name: b.name,
            desc: b.desc,
            url: b.shortUrl,
            lists: (b.lists ?? []).map((l: any) => ({ id: l.id, name: l.name })),
            labels: (b.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
            members: (b.members ?? []).map((m: any) => ({ id: m.id, fullName: m.fullName, username: m.username })),
        });
    },
);
