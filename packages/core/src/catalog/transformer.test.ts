// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadTransformer, applyTransform, spawnTransform } from "./transformer.js";

// ---------------------------------------------------------------------------
// loadTransformer
// ---------------------------------------------------------------------------

describe("loadTransformer", () => {
    // Use CJS format for temp files: `import()` of a CJS module exposes
    // module.exports as `mod.default`, which is what loadTransformer checks.
    it("loads a valid transform file and returns a callable function", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-transformer-"));
        const file = join(dir, "identity.cjs");
        writeFileSync(file, "module.exports = (data) => ({ wrapped: data });");

        const transform = await loadTransformer(file);
        const result = await applyTransform(transform, { key: "value" });
        expect(result).toEqual({ wrapped: { key: "value" } });
    });

    it("resolves relative paths using the provided baseDir", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-transformer-"));
        const file = join(dir, "double.cjs");
        writeFileSync(file, "module.exports = (n) => n * 2;");

        const transform = await loadTransformer("double.cjs", dir);
        const result = await applyTransform(transform, 21);
        expect(result).toBe(42);
    });

    it("throws when the default export is not a function", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-transformer-"));
        const file = join(dir, "not-a-fn.cjs");
        writeFileSync(file, "module.exports = 42;");

        await expect(loadTransformer(file)).rejects.toThrow(
            /must export a default function/,
        );
    });

    it("throws when module.exports is undefined (no default export)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-transformer-"));
        const file = join(dir, "no-default.cjs");
        writeFileSync(file, "exports.helper = () => {};");

        await expect(loadTransformer(file)).rejects.toThrow(
            /must export a default function/,
        );
    });
});

// ---------------------------------------------------------------------------
// applyTransform
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// spawnTransform
// ---------------------------------------------------------------------------

describe("spawnTransform", () => {
    it("executes a Python script, passes args via stdin, returns parsed JSON", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-spawn-"));
        const file = join(dir, "echo.py");
        writeFileSync(file, [
            "import json, sys",
            "args = json.load(sys.stdin)",
            'json.dump({"received": args}, sys.stdout)',
        ].join("\n"));

        const result = await spawnTransform("python3", file, { key: "value" });
        expect(result).toEqual({ received: { key: "value" } });
    });

    it("executes a shell script that reads stdin and writes JSON to stdout", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-spawn-"));
        const file = join(dir, "wrap.sh");
        writeFileSync(file, '#!/bin/sh\nread input\necho "{\\"input\\":$input}"');

        const result = await spawnTransform("bash", file, 42);
        expect(result).toEqual({ input: 42 });
    });

    it("rejects immediately when file is a relative path", async () => {
        await expect(spawnTransform("python3", "relative/path.py", {})).rejects.toThrow(
            /must be an absolute path/,
        );
    });

    it("rejects when the script exits with non-zero code", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-spawn-"));
        const file = join(dir, "fail.py");
        writeFileSync(file, "import sys\nsys.stderr.write('boom')\nsys.exit(1)");

        await expect(spawnTransform("python3", file, {})).rejects.toThrow(
            /exit 1.*boom/s,
        );
    });

    it("rejects when the script output is not valid JSON", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-spawn-"));
        const file = join(dir, "bad-json.py");
        writeFileSync(file, "import sys\nsys.stdout.write('not json')");

        await expect(spawnTransform("python3", file, {})).rejects.toThrow(
            /not valid JSON/,
        );
    });

    it("rejects with timeout error when script hangs", async () => {
        const dir = mkdtempSync(join(tmpdir(), "agentrun-spawn-"));
        const file = join(dir, "hang.py");
        writeFileSync(file, "import time\ntime.sleep(60)");

        await expect(
            spawnTransform("python3", file, {}, { timeoutMs: 200 }),
        ).rejects.toThrow(/timed out after 200ms/);
    }, 3000);
});

// ---------------------------------------------------------------------------
// applyTransform
// ---------------------------------------------------------------------------

describe("applyTransform", () => {
    it("applies a synchronous transformer", async () => {
        const transform = (data: unknown) => ({ result: data });
        const out = await applyTransform(transform, "hello");
        expect(out).toEqual({ result: "hello" });
    });

    it("applies an asynchronous transformer", async () => {
        const transform = async (data: unknown) => {
            await Promise.resolve();
            return (data as number) + 1;
        };
        const out = await applyTransform(transform, 41);
        expect(out).toBe(42);
    });

    it("passes the full args object unchanged when transformer is identity", async () => {
        const args = { summary: "Fix bug", issue_type: "Task" };
        const transform = (data: unknown) => data;
        const out = await applyTransform(transform, args);
        expect(out).toBe(args);
    });
});
