// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { PackManifestSchema } from "@agentrun-oss/core";
import { validateManifests } from "./validate.js";
import { syncManifests } from "./sync.js";
import { formatHuman } from "./output.js";

// Lazy-load AWS SDK so that `validate` (which doesn't need S3) works
// in environments without @aws-sdk installed (e.g., CI runners).
async function loadS3Sdk() {
    const sdk = await import("@aws-sdk/client-s3");
    return {
        S3Client: sdk.S3Client,
        GetObjectCommand: sdk.GetObjectCommand,
        PutObjectCommand: sdk.PutObjectCommand,
    };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackRegistryEntry {
    version: string;
    description: string;
    author: string;
    tags: string[];
    license: string;
    repository?: string;
    dependencies: string[];
    toolCount: number;
    workflowCount: number;
    useCaseCount: number;
    skillCount: number;
    updatedAt: string;
}

export interface PackRegistry {
    version: "1.0.0";
    packs: Record<string, PackRegistryEntry>;
    updatedAt: string;
}

export interface PackListItem {
    name: string;
    version: string;
    author: string;
    description: string;
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

async function fetchRegistry(bucket: string): Promise<PackRegistry> {
    const { S3Client, GetObjectCommand } = await loadS3Sdk();
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    try {
        const resp = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: "registry.json",
        }));
        const body = await resp.Body?.transformToString();
        if (body) {
            return JSON.parse(body) as PackRegistry;
        }
    } catch (err: any) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
            // Registry doesn't exist yet -- return empty
        } else {
            throw err;
        }
    }

    return { version: "1.0.0", packs: {}, updatedAt: new Date().toISOString() };
}

async function saveRegistry(bucket: string, registry: PackRegistry): Promise<void> {
    const { S3Client, PutObjectCommand } = await loadS3Sdk();
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: "registry.json",
        Body: JSON.stringify(registry, null, 2),
        ContentType: "application/json",
    }));
}

// ---------------------------------------------------------------------------
// Pack metadata extraction
// ---------------------------------------------------------------------------

function readPackManifest(dir: string): {
    name: string;
    version: string;
    description: string;
    author: string;
    tags: string[];
    license: string;
    repository?: string;
    dependencies: string[];
} | null {
    const packYamlPath = path.join(dir, "pack.yaml");
    const packYmlPath = path.join(dir, "pack.yml");
    const packPath = fs.existsSync(packYamlPath) ? packYamlPath : fs.existsSync(packYmlPath) ? packYmlPath : null;

    if (!packPath) return null;

    const content = fs.readFileSync(packPath, "utf-8");
    const doc = yaml.load(content) as any;
    const parsed = PackManifestSchema.parse(doc);

    return {
        name: parsed.metadata.name,
        version: parsed.metadata.version,
        description: parsed.spec.description,
        author: (parsed.spec as any).author ?? "unknown",
        tags: (parsed.spec as any).tags ?? [],
        license: (parsed.spec as any).license ?? "internal",
        repository: (parsed.spec as any).repository,
        dependencies: (parsed.spec as any).dependencies ?? parsed.spec.inherits,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listPacks(bucket: string): Promise<PackListItem[]> {
    const registry = await fetchRegistry(bucket);
    return Object.entries(registry.packs).map(([name, entry]) => ({
        name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
    }));
}

export async function getPackInfo(name: string, bucket: string): Promise<PackRegistryEntry | null> {
    const registry = await fetchRegistry(bucket);
    return registry.packs[name] ?? null;
}

export async function publishPack(dir: string, bucket: string): Promise<void> {
    // Step 1: Validate
    console.log("Step 1/4: Validating manifests...");
    const validation = validateManifests(dir);
    console.log(formatHuman(validation));

    if (validation.errors.length > 0) {
        console.error("\nPublish aborted: validation errors found.");
        process.exit(1);
    }

    // Step 2: Read pack metadata
    console.log("\nStep 2/4: Reading pack metadata...");
    const meta = readPackManifest(dir);
    if (!meta) {
        console.error("No pack.yaml found in directory. Cannot publish.");
        process.exit(1);
    }
    console.log(`  Pack: ${meta.name} v${meta.version}`);

    // Step 3: Sync to S3
    console.log("\nStep 3/4: Syncing to S3...");
    const syncResult = await syncManifests({
        dir,
        bucket,
        packName: meta.name,
        delete: true,
        dryRun: false,
    });
    console.log(`  Uploaded: ${syncResult.uploaded}, Deleted: ${syncResult.deleted}`);

    // Step 4: Update registry
    console.log("\nStep 4/4: Updating registry...");
    const registry = await fetchRegistry(bucket);
    registry.packs[meta.name] = {
        version: meta.version,
        description: meta.description,
        author: meta.author,
        tags: meta.tags,
        license: meta.license,
        repository: meta.repository,
        dependencies: meta.dependencies,
        toolCount: validation.tools,
        workflowCount: validation.workflows,
        useCaseCount: validation.useCases,
        skillCount: validation.skills,
        updatedAt: new Date().toISOString(),
    };
    registry.updatedAt = new Date().toISOString();
    await saveRegistry(bucket, registry);

    console.log(`\nPack "${meta.name}" v${meta.version} published to s3://${bucket}/packs/${meta.name}/`);
}
