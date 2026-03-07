#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

import { validateManifests } from "./validate.js";
import { syncManifests } from "./sync.js";
import { listPacks, getPackInfo, publishPack } from "./registry.js";
import { ingestDocument } from "./ingest.js";
import { formatHuman, formatJson } from "./output.js";
import { runEvals } from "./eval.js";
import type { EvalMode } from "./eval.js";
import { formatEvalHuman, formatEvalJson } from "./evalOutput.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): { flags: Record<string, string>; positional: string[] } {
    const flags: Record<string, string> = {};
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            // Boolean flags (no value)
            if (key === "delete" || key === "dry-run" || key === "json") {
                flags[key] = "true";
            } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                flags[key] = args[i + 1];
                i++;
            } else {
                flags[key] = "true";
            }
        } else {
            positional.push(args[i]);
        }
    }

    return { flags, positional };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runValidate(args: string[]): Promise<void> {
    const { flags, positional } = parseArgs(args);
    const dir = positional[0];

    if (!dir) {
        console.error("Usage: agentrun validate <dir> [--json] [--format json|human]");
        process.exit(1);
    }

    const result = validateManifests(dir);
    const useJson = flags["json"] === "true" || flags["format"] === "json";

    console.log(useJson ? formatJson(result) : formatHuman(result));
    process.exit(result.errors.length > 0 ? 1 : 0);
}

async function runSync(args: string[]): Promise<void> {
    const { flags, positional } = parseArgs(args);
    const dir = positional[0];
    const bucket = flags["bucket"];
    const packName = flags["pack"];

    if (!dir || !bucket || !packName) {
        console.error("Usage: agentrun sync <dir> --bucket <bucket> --pack <pack> [--delete] [--dry-run]");
        process.exit(1);
    }

    const dryRun = flags["dry-run"] === "true";
    const doDelete = flags["delete"] === "true";

    if (dryRun) {
        console.log("[DRY RUN] No changes will be made.\n");
    }

    console.log(`Syncing ${dir} -> s3://${bucket}/packs/${packName}/`);

    const result = await syncManifests({
        dir,
        bucket,
        packName,
        delete: doDelete,
        dryRun,
    });

    if (dryRun) {
        for (const action of result.actions) {
            console.log(`  ${action.type === "upload" ? "+" : "-"} ${action.key}`);
        }
    }

    console.log(`\nUploaded: ${result.uploaded}, Deleted: ${result.deleted}, Unchanged: ${result.unchanged}`);
}

async function runPackCommand(args: string[]): Promise<void> {
    const subCommand = args[0];
    const subArgs = args.slice(1);
    const { flags, positional } = parseArgs(subArgs);
    const bucket = flags["bucket"] ?? process.env.AGENTRUN_MANIFESTS_BUCKET;

    if (!bucket) {
        console.error("Error: --bucket is required (or set AGENTRUN_MANIFESTS_BUCKET)");
        process.exit(1);
    }

    switch (subCommand) {
        case "list": {
            const packs = await listPacks(bucket);
            if (packs.length === 0) {
                console.log("No packs found in registry.");
                return;
            }
            console.log("\nAvailable packs:\n");
            console.log(
                ["Name", "Version", "Author", "Description"]
                    .map((h) => h.padEnd(20))
                    .join(""),
            );
            console.log("-".repeat(80));
            for (const p of packs) {
                console.log(
                    [p.name, p.version, p.author, p.description]
                        .map((v, i) => (v ?? "").padEnd(i === 3 ? 40 : 20).slice(0, i === 3 ? 40 : 20))
                        .join(""),
                );
            }
            break;
        }

        case "info": {
            const name = positional[0];
            if (!name) {
                console.error("Usage: agentrun pack info <name> [--bucket <bucket>]");
                process.exit(1);
            }
            const info = await getPackInfo(name, bucket);
            if (!info) {
                console.error(`Pack "${name}" not found in registry.`);
                process.exit(1);
            }
            console.log(JSON.stringify(info, null, 2));
            break;
        }

        case "publish": {
            const dir = positional[0];
            if (!dir) {
                console.error("Usage: agentrun pack publish <dir> [--bucket <bucket>]");
                process.exit(1);
            }
            await publishPack(dir, bucket);
            break;
        }

        default:
            console.error(`Unknown pack subcommand: ${subCommand}`);
            console.error("Available: list, info, publish");
            process.exit(1);
    }
}

async function runIngest(args: string[]): Promise<void> {
    const { flags, positional } = parseArgs(args);
    const file = positional[0];

    if (!file) {
        console.error("Usage: agentrun ingest <file> [--source <name>] [--cluster-arn <arn>] [--secret-arn <arn>] [--dry-run]");
        process.exit(1);
    }

    const source = flags["source"] ?? require("path").basename(file);
    const clusterArn = flags["cluster-arn"] ?? process.env.AGENTRUN_CLUSTER_ARN ?? "";
    const secretArn = flags["secret-arn"] ?? process.env.AGENTRUN_SECRET_ARN ?? "";
    const database = flags["database"] ?? process.env.AGENTRUN_DATABASE ?? "";
    const schema = flags["schema"] ?? process.env.AGENTRUN_SCHEMA ?? "agentrun";
    const region = flags["region"] ?? process.env.AWS_REGION ?? "us-east-1";
    const embeddingModel = flags["embedding-model"] ?? "amazon.titan-embed-text-v2:0";
    const dimensions = parseInt(flags["dimensions"] ?? "1024", 10);
    const maxTokens = parseInt(flags["max-tokens"] ?? "512", 10);
    const overlap = parseInt(flags["overlap"] ?? "50", 10);
    const dryRun = flags["dry-run"] === "true";

    if (!dryRun && (!clusterArn || !secretArn)) {
        console.error("Error: --cluster-arn and --secret-arn are required (or set AGENTRUN_CLUSTER_ARN / AGENTRUN_SECRET_ARN)");
        process.exit(1);
    }

    if (!dryRun && !database) {
        console.error("Error: --database is required (or set AGENTRUN_DATABASE)");
        process.exit(1);
    }

    console.log(`Ingesting document: ${file}`);
    console.log(`  Source: ${source}`);
    if (dryRun) console.log("  [DRY RUN]");

    const result = await ingestDocument({
        file,
        source,
        clusterArn,
        secretArn,
        database,
        schema,
        region,
        embeddingModel,
        dimensions,
        maxTokens,
        overlap,
        dryRun,
    });

    console.log(`\nResult: ${result.chunks} chunks, ${result.embedded} embedded, ${result.upserted} upserted, ${result.totalTokens} tokens`);
}

// ---------------------------------------------------------------------------
// Eval command
// ---------------------------------------------------------------------------

async function runEval(args: string[]): Promise<void> {
    const { flags, positional } = parseArgs(args);
    const dir = positional[0];

    if (!dir) {
        console.error("Usage: agentrun eval <dir> [--mode trigger|execution|all] [--filter <name>] [--json] [--threshold <0.0-1.0>]");
        process.exit(1);
    }

    const mode = (flags["mode"] ?? "all") as EvalMode;
    if (!["trigger", "execution", "all"].includes(mode)) {
        console.error(`Invalid mode: ${mode}. Must be trigger, execution, or all.`);
        process.exit(1);
    }

    const threshold = parseFloat(flags["threshold"] ?? "0.8");
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.error("Threshold must be a number between 0.0 and 1.0");
        process.exit(1);
    }

    const filter = flags["filter"];
    const useJson = flags["json"] === "true" || flags["format"] === "json";

    const summary = await runEvals({
        dir,
        mode,
        filter,
        threshold,
        onProgress: useJson ? undefined : (msg) => console.log(msg),
    });

    console.log(useJson ? formatEvalJson(summary) : formatEvalHuman(summary));
    process.exit(summary.overallPass ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);

    switch (command) {
        case "validate":
            await runValidate(args);
            break;
        case "sync":
            await runSync(args);
            break;
        case "pack":
            await runPackCommand(args);
            break;
        case "ingest":
            await runIngest(args);
            break;
        case "eval":
            await runEval(args);
            break;
        case "help":
        case "--help":
        case "-h":
        case undefined:
            printUsage();
            break;
        default:
            console.error(`Unknown command: ${command}\n`);
            printUsage();
            process.exit(1);
    }
}

function printUsage(): void {
    console.log(`
agentrun — AgentRun manifest tooling CLI

Commands:
  validate <dir>                Validate manifest YAML files
    --json                      Output as JSON
    --format json|human         Output format (default: human)

  sync <dir>                    Sync manifests to S3
    --bucket <bucket>           S3 bucket name (required)
    --pack <pack>               Pack name (required)
    --delete                    Delete orphaned remote files
    --dry-run                   Show plan without executing

  pack list                     List available packs from registry
    --bucket <bucket>           S3 bucket (or AGENTRUN_MANIFESTS_BUCKET)

  pack info <name>              Show pack details
    --bucket <bucket>           S3 bucket

  pack publish <dir>            Validate, sync, and update registry
    --bucket <bucket>           S3 bucket

  eval <dir>                    Run eval cases against skills/use-cases
    --mode trigger|execution|all  Eval mode (default: all)
    --filter <name>             Filter evals by name pattern
    --json                      Output as JSON
    --threshold <0.0-1.0>       Pass/fail threshold (default: 0.8)

  ingest <file>                 Ingest a document into the knowledge base
    --source <name>             Source name (default: filename)
    --cluster-arn <arn>         Aurora cluster ARN (or AGENTRUN_CLUSTER_ARN)
    --secret-arn <arn>          Secrets Manager ARN (or AGENTRUN_SECRET_ARN)
    --database <db>             Database name (or AGENTRUN_DATABASE)
    --schema <schema>           DB schema name (default: agentrun, or AGENTRUN_SCHEMA)
    --embedding-model <model>   Bedrock model (default: amazon.titan-embed-text-v2:0)
    --dimensions <n>            Vector dimensions (default: 1024)
    --max-tokens <n>            Max tokens per chunk (default: 512)
    --overlap <n>               Overlap tokens (default: 50)
    --dry-run                   Show chunks without ingesting

Environment:
  AWS_REGION                    AWS region (default: us-east-1)
  AGENTRUN_MANIFESTS_BUCKET     Default S3 bucket for pack commands
  AGENTRUN_CLUSTER_ARN          Aurora cluster ARN for ingest
  AGENTRUN_SECRET_ARN           Secrets Manager ARN for ingest
  AGENTRUN_DATABASE             Database name for ingest
  AGENTRUN_SCHEMA               Schema name for ingest (default: agentrun)
`);
}

main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});
