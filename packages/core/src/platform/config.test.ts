import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { z } from "zod";
import { loadPlatformConfig, getSpecField } from "./config.js";
import { PlatformRegistry } from "./registry.js";

const MIN_INLINE_CONFIG = {
    apiVersion: "agentrun/v1",
    kind: "PlatformConfig",
    metadata: { name: "test-platform" },
    spec: {
        providers: {
            llm: { type: "stub", config: {} },
            credentials: { type: "stub", config: {} },
            session: { type: "stub", config: {} },
            usage: { type: "stub", config: {} },
            manifests: { type: "stub", config: {} },
            secrets: { type: "stub", config: {} },
        },
        identity: { sources: [{ type: "slack" }] },
        roles: {},
        users: [],
        environment: {
            name: "test",
            cloud: "gcp",
            account: "acct",
            region: "us-central1",
            env: "dev",
            resources: [],
            repos: [],
        },
    },
} as const;

function withInline(spec: Record<string, unknown>) {
    process.env.AGENTRUN_CONFIG_INLINE = JSON.stringify({
        ...MIN_INLINE_CONFIG,
        spec: { ...MIN_INLINE_CONFIG.spec, ...spec },
    });
}

describe("PlatformConfigSchema with passthrough()", () => {
    beforeEach(() => {
        delete process.env.AGENTRUN_CONFIG_INLINE;
        delete process.env.AGENTRUN_PLATFORM_CONFIG;
    });

    afterEach(() => {
        delete process.env.AGENTRUN_CONFIG_INLINE;
    });

    it("preserves unknown spec.* keys after parsing", async () => {
        withInline({
            teams: [{ name: "powerplant", members: ["paulo@x.com"] }],
            packs: ["alpha", "beta"],
        });
        const config = await loadPlatformConfig();
        expect(config).not.toBeNull();
        const spec = config!.spec as unknown as Record<string, unknown>;
        expect(spec.teams).toEqual([{ name: "powerplant", members: ["paulo@x.com"] }]);
        expect(spec.packs).toEqual(["alpha", "beta"]);
    });

    it("still rejects malformed known fields", async () => {
        process.env.AGENTRUN_CONFIG_INLINE = JSON.stringify({
            ...MIN_INLINE_CONFIG,
            metadata: {}, // missing name
        });
        await expect(loadPlatformConfig()).rejects.toThrow();
    });
});

describe("getSpecField", () => {
    beforeEach(async () => {
        delete process.env.AGENTRUN_CONFIG_INLINE;
        withInline({
            teams: [{ name: "powerplant", members: ["paulo@x.com"] }],
            customNumber: 42,
        });
        const config = await loadPlatformConfig();
        if (config) PlatformRegistry.instance().setConfig(config);
    });

    afterEach(() => {
        delete process.env.AGENTRUN_CONFIG_INLINE;
    });

    it("returns the parsed value when the schema validates", () => {
        const TeamsSchema = z.array(
            z.object({ name: z.string(), members: z.array(z.string()) }),
        );
        const teams = getSpecField("teams", TeamsSchema);
        expect(teams).toEqual([{ name: "powerplant", members: ["paulo@x.com"] }]);
    });

    it("returns undefined when the field is absent", () => {
        const result = getSpecField("nonexistent", z.string());
        expect(result).toBeUndefined();
    });

    it("returns undefined and logs a warning when validation fails", () => {
        const result = getSpecField("customNumber", z.string());
        expect(result).toBeUndefined();
    });
});
