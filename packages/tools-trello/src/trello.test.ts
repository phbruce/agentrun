// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { trelloApi, setTrelloCredentialsResolver, TrelloNotConnectedError } from "./_api.js";
import { createTrelloTools } from "./index.js";

type Call = { url: string; init: any };

let calls: Call[];
let responses: Array<{ status: number; body: unknown }>;
const realFetch = globalThis.fetch;

beforeEach(() => {
    calls = [];
    responses = [];
    process.env.TRELLO_API_KEY = "k".repeat(32);
    process.env.TRELLO_TOKEN = "ATTAtoken";
    globalThis.fetch = jest.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        const r = responses.shift() ?? { status: 200, body: {} };
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
    }) as any;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    setTrelloCredentialsResolver(null);
    delete process.env.TRELLO_API_KEY;
    delete process.env.TRELLO_TOKEN;
});

const tools = Object.fromEntries(createTrelloTools().map((t: any) => [t.name, t]));
const run = (name: string, args: unknown) => (tools[name] as any).handler(args, null);
const parse = (r: any) => JSON.parse(r.content[0].text);

describe("trelloApi", () => {
    it("sends key and token in the OAuth header, never in the URL", async () => {
        responses.push({ status: 200, body: [] });
        await trelloApi("GET", "/members/me/boards", { filter: "open" });
        expect(calls[0].url).toBe("https://api.trello.com/1/members/me/boards?filter=open");
        expect(calls[0].url).not.toContain("ATTAtoken");
        expect(calls[0].init.headers.Authorization).toBe(`OAuth oauth_consumer_key="${"k".repeat(32)}", oauth_token="ATTAtoken"`);
    });

    it("fails clearly without credentials", async () => {
        delete process.env.TRELLO_TOKEN;
        await expect(trelloApi("GET", "/members/me")).rejects.toThrow(TrelloNotConnectedError);
        expect(calls).toHaveLength(0);
    });

    it("uses the registered resolver instead of the environment", async () => {
        setTrelloCredentialsResolver(async () => ({ apiKey: "userkey", token: "usertoken" }));
        await trelloApi("GET", "/members/me");
        expect(calls[0].init.headers.Authorization).toBe('OAuth oauth_consumer_key="userkey", oauth_token="usertoken"');
    });

    it("does not fall back to the environment when the resolver has no credentials", async () => {
        setTrelloCredentialsResolver(() => null);
        await expect(trelloApi("GET", "/members/me")).rejects.toThrow(TrelloNotConnectedError);
        expect(calls).toHaveLength(0);
    });

    it("lets the resolver raise its own message", async () => {
        setTrelloCredentialsResolver(() => { throw new TrelloNotConnectedError("connect first"); });
        await expect(trelloApi("GET", "/members/me")).rejects.toThrow("connect first");
    });

    it("surfaces Trello errors with status and body", async () => {
        responses.push({ status: 401, body: "invalid token" });
        await expect(trelloApi("GET", "/members/me")).rejects.toThrow("Trello API 401: invalid token");
    });
});

describe("tools", () => {
    it("exposes 11 tools with unique snake_case names", () => {
        const names = Object.keys(tools);
        expect(names).toHaveLength(11);
        for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
    });

    it("create_trello_card posts a JSON body with joined ids", async () => {
        responses.push({ status: 200, body: { id: "c1", name: "X", shortUrl: "u", idList: "l1" } });
        const out = parse(await run("create_trello_card", { listId: "l1", name: "X", labelIds: ["a", "b"] }));
        expect(calls[0].init.method).toBe("POST");
        expect(calls[0].url).toBe("https://api.trello.com/1/cards");
        expect(JSON.parse(calls[0].init.body)).toEqual({ idList: "l1", name: "X", idLabels: "a,b" });
        expect(out).toEqual({ id: "c1", name: "X", url: "u", idList: "l1" });
    });

    it("update_trello_card sends only the fields given and maps archive and due clear", async () => {
        responses.push({ status: 200, body: { id: "c1", name: "X", closed: true } });
        await run("update_trello_card", { cardId: "abc", archived: true, due: null });
        expect(calls[0].init.method).toBe("PUT");
        expect(JSON.parse(calls[0].init.body)).toEqual({ closed: true, due: "" });
    });

    it("update_trello_card refuses an empty update", async () => {
        await expect(run("update_trello_card", { cardId: "abc" })).rejects.toThrow("Nothing to update");
        expect(calls).toHaveLength(0);
    });

    it("list_trello_cards needs a board or a list", async () => {
        await expect(run("list_trello_cards", {})).rejects.toThrow("Pass boardId or listId");
    });

    it("search_trello_cards limits to boards and defaults to 25 cards", async () => {
        responses.push({ status: 200, body: { cards: [{ id: "c1", name: "deploy", labels: [] }] } });
        const out = parse(await run("search_trello_cards", { query: "deploy", boardIds: ["b1", "b2"] }));
        const url = new URL(calls[0].url);
        expect(url.pathname).toBe("/1/search");
        expect(url.searchParams.get("idBoards")).toBe("b1,b2");
        expect(url.searchParams.get("cards_limit")).toBe("25");
        expect(out.total).toBe(1);
    });

    it("add_trello_checklist creates the checklist then each item in order", async () => {
        responses.push({ status: 200, body: { id: "cl1", name: "Deploy" } });
        responses.push({ status: 200, body: { id: "i1", name: "build", state: "incomplete" } });
        responses.push({ status: 200, body: { id: "i2", name: "smoke", state: "incomplete" } });
        const out = parse(await run("add_trello_checklist", { cardId: "abc", name: "Deploy", items: ["build", "smoke"] }));
        expect(calls.map(c => c.url)).toEqual([
            "https://api.trello.com/1/cards/abc/checklists",
            "https://api.trello.com/1/checklists/cl1/checkItems",
            "https://api.trello.com/1/checklists/cl1/checkItems",
        ]);
        expect(out.items.map((i: any) => i.name)).toEqual(["build", "smoke"]);
    });

    it("update_trello_checklist_item maps complete to Trello state", async () => {
        responses.push({ status: 200, body: { id: "i1", name: "build", state: "complete" } });
        await run("update_trello_checklist_item", { cardId: "abc", itemId: "i1", complete: true });
        expect(calls[0].url).toBe("https://api.trello.com/1/cards/abc/checkItem/i1");
        expect(JSON.parse(calls[0].init.body)).toEqual({ state: "complete" });
    });
});
