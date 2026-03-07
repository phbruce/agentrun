// SPDX-License-Identifier: AGPL-3.0-only
// esbuild-cli.js — Build @agentrun-ai/cli as a single self-contained ESM file
import * as esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["packages/cli/src/index.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: "dist/agentrun-cli.mjs",
    banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    // Bundle everything including AWS SDK — zero external deps at runtime.
    // This makes the CLI fully self-contained for CI runners.
    loader: { ".yaml": "text" },
    minify: false,
});

console.log("CLI built: dist/agentrun-cli.mjs");
