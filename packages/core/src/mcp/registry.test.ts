// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
    registerToolFactory,
    registerPackToolFactory,
    getPackToolFactories,
    getToolRegistry,
    getToolRegistryWithPacks,
    _resetToolRegistries,
    type ToolHandler,
} from "./registry.js";

const handler = (name: string): ToolHandler => ({
    name,
    handler: async () => ({ ok: true, name }),
});

beforeEach(() => {
    _resetToolRegistries();
});

describe("MCP tool registry — globals", () => {
    it("merges multiple global factories preserving last-write-wins", () => {
        registerToolFactory(() => new Map([["a", handler("a-1")]]));
        registerToolFactory(() => new Map([["b", handler("b")], ["a", handler("a-2")]]));

        const reg = getToolRegistry();
        expect(reg.size).toBe(2);
        expect(reg.get("a")?.name).toBe("a-2");
        expect(reg.get("b")?.name).toBe("b");
    });

    it("returns an empty map when no factories registered", () => {
        expect(getToolRegistry().size).toBe(0);
    });
});

describe("MCP tool registry — pack-scoped", () => {
    it("registers a pack factory and reads it back", () => {
        registerPackToolFactory("payments", "charge", (_secrets) => handler("charge"));

        const factories = getPackToolFactories("payments");
        expect(Object.keys(factories)).toEqual(["charge"]);
    });

    it("getToolRegistryWithPacks merges global + pack tools", () => {
        registerToolFactory(() => new Map([["global-tool", handler("global-tool")]]));
        registerPackToolFactory("payments", "charge", () => handler("charge"));
        registerPackToolFactory("payments", "refund", () => handler("refund"));

        const reg = getToolRegistryWithPacks(["payments"], new Map());
        expect(reg.size).toBe(3);
        expect(reg.has("global-tool")).toBe(true);
        expect(reg.has("charge")).toBe(true);
        expect(reg.has("refund")).toBe(true);
    });

    it("pack-scoped tools override global tools with the same name", () => {
        registerToolFactory(() => new Map([["sync", handler("global-sync")]]));
        registerPackToolFactory("payments", "sync", () => handler("pack-sync"));

        const reg = getToolRegistryWithPacks(["payments"], new Map());
        expect(reg.get("sync")?.name).toBe("pack-sync");
    });

    it("ignores pack names with no registered factories", () => {
        registerToolFactory(() => new Map([["g", handler("g")]]));
        const reg = getToolRegistryWithPacks(["unknown-pack"], new Map());
        expect(reg.size).toBe(1);
        expect(reg.has("g")).toBe(true);
    });

    it("passes the resolved secrets map to each pack factory", () => {
        const seen: string[] = [];
        registerPackToolFactory("payments", "charge", (secrets) => {
            seen.push(secrets.get("API_KEY") ?? "<missing>");
            return handler("charge");
        });

        const secrets = new Map([["API_KEY", "abc"]]);
        getToolRegistryWithPacks(["payments"], secrets);
        expect(seen).toEqual(["abc"]);
    });

    it("processes multiple packs in the order given", () => {
        registerPackToolFactory("a", "tool", () => handler("a-tool"));
        registerPackToolFactory("b", "tool", () => handler("b-tool"));

        const ab = getToolRegistryWithPacks(["a", "b"], new Map());
        expect(ab.get("tool")?.name).toBe("b-tool"); // b wins (last)

        _resetToolRegistries();
        registerPackToolFactory("a", "tool", () => handler("a-tool"));
        registerPackToolFactory("b", "tool", () => handler("b-tool"));
        const ba = getToolRegistryWithPacks(["b", "a"], new Map());
        expect(ba.get("tool")?.name).toBe("a-tool"); // a wins (last)
    });
});
