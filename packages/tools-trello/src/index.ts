// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-ai/tools-trello — Trello boards, lists, cards and checklists

export { trelloApi, setTrelloCredentialsResolver, TrelloNotConnectedError } from "./_api.js";
export type { TrelloCredentials, TrelloCredentialsResolver } from "./_api.js";
export { listTrelloBoards } from "./listTrelloBoards.js";
export { getTrelloBoard } from "./getTrelloBoard.js";
export { listTrelloCards } from "./listTrelloCards.js";
export { searchTrelloCards } from "./searchTrelloCards.js";
export { getTrelloCard } from "./getTrelloCard.js";
export { createTrelloCard } from "./createTrelloCard.js";
export { updateTrelloCard } from "./updateTrelloCard.js";
export { addTrelloComment } from "./addTrelloComment.js";
export { addTrelloChecklist } from "./addTrelloChecklist.js";
export { updateTrelloChecklistItem } from "./updateTrelloChecklistItem.js";
export { createTrelloList } from "./createTrelloList.js";

import { listTrelloBoards } from "./listTrelloBoards.js";
import { getTrelloBoard } from "./getTrelloBoard.js";
import { listTrelloCards } from "./listTrelloCards.js";
import { searchTrelloCards } from "./searchTrelloCards.js";
import { getTrelloCard } from "./getTrelloCard.js";
import { createTrelloCard } from "./createTrelloCard.js";
import { updateTrelloCard } from "./updateTrelloCard.js";
import { addTrelloComment } from "./addTrelloComment.js";
import { addTrelloChecklist } from "./addTrelloChecklist.js";
import { updateTrelloChecklistItem } from "./updateTrelloChecklistItem.js";
import { createTrelloList } from "./createTrelloList.js";

export function createTrelloTools() {
    return [
        listTrelloBoards,
        getTrelloBoard,
        listTrelloCards,
        searchTrelloCards,
        getTrelloCard,
        createTrelloCard,
        updateTrelloCard,
        addTrelloComment,
        addTrelloChecklist,
        updateTrelloChecklistItem,
        createTrelloList,
    ];
}
