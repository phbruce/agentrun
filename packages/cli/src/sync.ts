// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";

// Lazy-load AWS SDK so that `validate` (which doesn't need S3) works
// in environments without @aws-sdk installed (e.g., CI runners).
async function loadS3Sdk() {
    const sdk = await import("@aws-sdk/client-s3");
    return {
        S3Client: sdk.S3Client,
        ListObjectsV2Command: sdk.ListObjectsV2Command,
        PutObjectCommand: sdk.PutObjectCommand,
        DeleteObjectCommand: sdk.DeleteObjectCommand,
    };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncOptions {
    dir: string;
    bucket: string;
    packName: string;
    delete: boolean;
    dryRun: boolean;
    region?: string;
}

interface SyncAction {
    type: "upload" | "delete";
    key: string;
    localPath?: string;
}

export interface SyncResult {
    uploaded: number;
    deleted: number;
    unchanged: number;
    actions: SyncAction[];
}

// ---------------------------------------------------------------------------
// Exclusions (same as GHA workflow)
// ---------------------------------------------------------------------------

const EXCLUDED_PATTERNS = [
    "README.md",
    "user-skills/",
    "hooks-example.json",
];

function isExcluded(relPath: string): boolean {
    for (const pattern of EXCLUDED_PATTERNS) {
        if (pattern.endsWith("/")) {
            if (relPath.startsWith(pattern) || relPath.includes("/" + pattern)) return true;
        } else {
            const basename = path.basename(relPath);
            if (basename === pattern) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// File walker (YAML only, with exclusions)
// ---------------------------------------------------------------------------

function walkSyncableFiles(dir: string): Map<string, string> {
    const files = new Map<string, string>();

    function walk(currentDir: string) {
        if (!fs.existsSync(currentDir)) return;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const full = path.join(currentDir, entry.name);
            const relPath = path.relative(dir, full);

            if (entry.isDirectory()) {
                if (!isExcluded(relPath + "/")) {
                    walk(full);
                }
            } else if (
                (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) &&
                !isExcluded(relPath)
            ) {
                files.set(relPath, full);
            }
        }
    }

    walk(dir);
    return files;
}

// ---------------------------------------------------------------------------
// S3 operations
// ---------------------------------------------------------------------------

async function listRemoteFiles(s3: any, bucket: string, prefix: string): Promise<Set<string>> {
    const { ListObjectsV2Command } = await loadS3Sdk();
    const keys = new Set<string>();
    let continuationToken: string | undefined;

    do {
        const resp = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));

        for (const obj of resp.Contents ?? []) {
            if (obj.Key) {
                const relKey = obj.Key.slice(prefix.length);
                keys.add(relKey);
            }
        }

        continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    return keys;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncManifests(opts: SyncOptions): Promise<SyncResult> {
    const { S3Client } = await loadS3Sdk();
    const s3 = new S3Client({ region: opts.region ?? process.env.AWS_REGION ?? "us-east-1" });
    const prefix = `packs/${opts.packName}/`;

    // Collect local files
    const localFiles = walkSyncableFiles(opts.dir);

    // List remote files
    const remoteKeys = await listRemoteFiles(s3, opts.bucket, prefix);

    // Compute actions
    const actions: SyncAction[] = [];
    let unchanged = 0;

    // Upload new or changed files
    for (const [relPath] of localFiles) {
        const s3Key = relPath.replace(/\\/g, "/"); // normalize Windows paths
        if (remoteKeys.has(s3Key)) {
            remoteKeys.delete(s3Key); // mark as seen
        }
        // Always upload (--size-only comparison would require HEAD requests; keep simple)
        actions.push({ type: "upload", key: prefix + s3Key, localPath: localFiles.get(relPath)! });
    }

    // Delete orphaned remote files
    if (opts.delete) {
        for (const orphanKey of remoteKeys) {
            actions.push({ type: "delete", key: prefix + orphanKey });
        }
    } else {
        unchanged += remoteKeys.size;
    }

    // Execute
    if (!opts.dryRun) {
        for (const action of actions) {
            const { PutObjectCommand, DeleteObjectCommand } = await loadS3Sdk();
            if (action.type === "upload" && action.localPath) {
                const body = fs.readFileSync(action.localPath, "utf-8");
                await s3.send(new PutObjectCommand({
                    Bucket: opts.bucket,
                    Key: action.key,
                    Body: body,
                    ContentType: "text/yaml",
                }));
            } else if (action.type === "delete") {
                await s3.send(new DeleteObjectCommand({
                    Bucket: opts.bucket,
                    Key: action.key,
                }));
            }
        }
    }

    const uploaded = actions.filter((a) => a.type === "upload").length;
    const deleted = actions.filter((a) => a.type === "delete").length;

    return { uploaded, deleted, unchanged, actions };
}
