// SPDX-License-Identifier: AGPL-3.0-only

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { trelloApi, textResult } from "./_api.js";

export const listTrelloBoards = tool(
    "list_trello_boards",
    "List the Trello boards the token's member can access (open boards by default).",
    {
        includeClosed: z.boolean().optional().describe("Include closed (archived) boards. Default false"),
    },
    async (args) => {
        const boards = await trelloApi("GET", "/members/me/boards", {
            filter: args.includeClosed ? "all" : "open",
            fields: "name,desc,closed,shortUrl,idOrganization,dateLastActivity",
        });
        return textResult(boards.map((b: any) => ({
            id: b.id,
            name: b.name,
            closed: b.closed,
            url: b.shortUrl,
            idOrganization: b.idOrganization,
            lastActivity: b.dateLastActivity,
        })));
    },
);
