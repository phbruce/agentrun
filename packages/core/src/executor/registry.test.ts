// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import { ExecutorRegistry } from "./registry.js";
import type { Executor } from "./types.js";

const fakeExecutor = (type: string): Executor => ({
    type,
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
});

describe("ExecutorRegistry", () => {
    it("registers and retrieves executors by type", () => {
        const reg = new ExecutorRegistry();
        const e = fakeExecutor("http");
        reg.register(e);
        expect(reg.has("http")).toBe(true);
        expect(reg.get("http")).toBe(e);
        expect(reg.list()).toEqual(["http"]);
    });

    it("rejects duplicate registrations", () => {
        const reg = new ExecutorRegistry();
        reg.register(fakeExecutor("http"));
        expect(() => reg.register(fakeExecutor("http"))).toThrow(/already registered/);
    });

    it("throws on get() for unknown type", () => {
        const reg = new ExecutorRegistry();
        expect(() => reg.get("nope")).toThrow(/No executor registered/);
    });

    it("supports protocol-agnostic types (any string)", () => {
        const reg = new ExecutorRegistry();
        for (const t of ["http", "cli", "gcp-sdk", "grpc", "lambda", "mcp-server", "custom-future"]) {
            reg.register(fakeExecutor(t));
        }
        expect(reg.list().length).toBe(7);
    });

    it("returns an immutable snapshot from list()", () => {
        const reg = new ExecutorRegistry();
        reg.register(fakeExecutor("a"));
        const snapshot = reg.list();
        reg.register(fakeExecutor("b"));
        // The original snapshot should not include 'b'
        expect(snapshot.includes("b")).toBe(false);
    });
});
