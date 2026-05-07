// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import {
    SlashCommandRouter,
    parseSlashCommandBody,
    type SlashCommandPayload,
} from "./slashCommand.js";

const samplePayload = (overrides: Partial<SlashCommandPayload> = {}): SlashCommandPayload => ({
    team_id: "T1",
    channel_id: "C1",
    user_id: "U1",
    command: "/hello",
    text: "world",
    response_url: "https://hooks.slack.example/r/1",
    trigger_id: "trig.1",
    ...overrides,
});

describe("parseSlashCommandBody", () => {
    it("parses a complete URL-encoded form body", () => {
        const body =
            "team_id=T1&channel_id=C1&user_id=U1&command=%2Fhello&text=world&" +
            "response_url=https%3A%2F%2Fhooks.slack.example%2Fr%2F1&trigger_id=trig.1";
        const out = parseSlashCommandBody(body);
        expect(out.command).toBe("/hello");
        expect(out.text).toBe("world");
        expect(out.response_url).toBe("https://hooks.slack.example/r/1");
    });

    it("accepts URLSearchParams directly", () => {
        const params = new URLSearchParams();
        params.set("team_id", "T1");
        params.set("channel_id", "C1");
        params.set("user_id", "U1");
        params.set("command", "/x");
        params.set("text", "");
        params.set("response_url", "https://x");
        params.set("trigger_id", "t");
        const out = parseSlashCommandBody(params);
        expect(out.command).toBe("/x");
        expect(out.text).toBe("");
    });

    it("throws when a required field is missing", () => {
        const params = new URLSearchParams("team_id=T1&channel_id=C1");
        expect(() => parseSlashCommandBody(params)).toThrow(/missing required field/);
    });

    it("preserves optional fields when present", () => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries({
            team_id: "T1", channel_id: "C1", user_id: "U1",
            command: "/x", text: "", response_url: "https://x", trigger_id: "t",
            user_name: "alice", channel_name: "general",
        })) params.set(k, v);
        const out = parseSlashCommandBody(params);
        expect(out.user_name).toBe("alice");
        expect(out.channel_name).toBe("general");
    });
});

describe("SlashCommandRouter", () => {
    it("dispatches to the registered handler by command name", async () => {
        const router = new SlashCommandRouter();
        let seen = "";
        router.register("hello", async (p) => {
            seen = p.text;
        });
        await router.dispatch(samplePayload());
        expect(seen).toBe("world");
    });

    it("normalizes the leading slash on registration AND dispatch", async () => {
        const router = new SlashCommandRouter();
        router.register("/foo", async () => ({ response_type: "ephemeral", text: "hi" }));
        const r = await router.dispatch(samplePayload({ command: "foo" }));
        expect(r).toEqual({ response_type: "ephemeral", text: "hi" });
    });

    it("rejects duplicate registrations", () => {
        const router = new SlashCommandRouter();
        router.register("foo", async () => undefined);
        expect(() => router.register("foo", async () => undefined)).toThrow(/already registered/);
        expect(() => router.register("/foo", async () => undefined)).toThrow(/already registered/);
    });

    it("returns an ephemeral 'unknown command' response when not registered", async () => {
        const router = new SlashCommandRouter();
        router.register("hello", async () => undefined);
        const r = await router.dispatch(samplePayload({ command: "/wat" }));
        expect(r).toMatchObject({ response_type: "ephemeral" });
        expect(String(r?.text)).toContain("Unknown command");
        expect(String(r?.text)).toContain("/hello");
    });

    it("list() returns registered command names without slash", () => {
        const router = new SlashCommandRouter();
        router.register("/a", async () => undefined);
        router.register("b", async () => undefined);
        expect([...router.list()].sort()).toEqual(["a", "b"]);
    });

    it("has() returns true with or without leading slash", () => {
        const router = new SlashCommandRouter();
        router.register("foo", async () => undefined);
        expect(router.has("foo")).toBe(true);
        expect(router.has("/foo")).toBe(true);
    });
});
