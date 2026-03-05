// SPDX-License-Identifier: AGPL-3.0-only
import esbuild from "esbuild";

const handlers = ["events", "process", "mcp-server"];

const sharedOptions = {
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    sourcemap: true,
    minify: true,
    // AWS SDK v3 is provided by the Lambda runtime
    external: [
        "@aws-sdk/client-dynamodb",
        "@aws-sdk/client-sqs",
        "@aws-sdk/client-s3",
        "@aws-sdk/client-sts",
        "@aws-sdk/client-ssm",
        "@aws-sdk/client-bedrock-runtime",
        "@aws-sdk/client-rds-data",
    ],
    banner: {
        js: [
            'import { createRequire } from "module";',
            "const require = createRequire(import.meta.url);",
        ].join("\n"),
    },
};

async function build() {
    for (const handler of handlers) {
        await esbuild.build({
            ...sharedOptions,
            entryPoints: [`src/handlers/${handler}.ts`],
            outfile: `dist/${handler}/index.mjs`,
        });
        console.log(`Built: dist/${handler}/index.mjs`);
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
