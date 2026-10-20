// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult } from "./_api.js";

export const getTrelloCard = tool(
    "get_trello_card",
    "Get full details of a Trello card: description, list, due date, labels, members, checklists and recent comments.",
    {
        cardId: z.string().describe("Card id or short link (from the card URL)"),
    },
    async (args) => {
        const id = encodeURIComponent(args.cardId);
        const [c, comments] = await Promise.all([
            trelloApi("GET", `/cards/${id}`, {
                fields: "name,desc,idList,idBoard,due,dueComplete,closed,labels,shortUrl,dateLastActivity",
                list: true,
                list_fields: "name",
                members: true,
                member_fields: "fullName,username",
                checklists: "all",
                checklist_fields: "name",
            }),
            trelloApi("GET", `/cards/${id}/actions`, { filter: "commentCard", limit: 20 }),
        ]);
        return textResult({
            id: c.id,
            name: c.name,
            desc: c.desc,
            url: c.shortUrl,
            list: c.list ? { id: c.list.id, name: c.list.name } : { id: c.idList },
            idBoard: c.idBoard,
            due: c.due ?? null,
            dueComplete: c.dueComplete ?? false,
            closed: c.closed ?? false,
            labels: (c.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
            members: (c.members ?? []).map((m: any) => ({ id: m.id, fullName: m.fullName, username: m.username })),
            checklists: (c.checklists ?? []).map((cl: any) => ({
                id: cl.id,
                name: cl.name,
                items: (cl.checkItems ?? []).map((i: any) => ({ id: i.id, name: i.name, state: i.state })),
            })),
            comments: (comments ?? []).map((a: any) => ({
                id: a.id,
                author: a.memberCreator?.fullName,
                date: a.date,
                text: a.data?.text,
            })),
            lastActivity: c.dateLastActivity,
        });
    },
);
