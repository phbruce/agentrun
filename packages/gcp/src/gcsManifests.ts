// SPDX-License-Identifier: AGPL-3.0-only

import { Storage } from "@google-cloud/storage";
import type { ManifestStore } from "@agentrun-ai/core";

/**
 * Google Cloud Storage-backed ManifestStore.
 *
 * Stores YAML manifest files in a GCS bucket.
 *
 * @param bucket - GCS bucket name
 */
export class GcsManifestStore implements ManifestStore {
    private storage: Storage;
    private bucket: string;

    constructor(bucket: string) {
        this.storage = new Storage();
        this.bucket = bucket;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const [files] = await this.storage.bucket(this.bucket).getFiles({ prefix });

        return files
            .filter((f) => f.name.endsWith(".yaml") || f.name.endsWith(".yml"))
            .map((f) => f.name);
    }

    async getFile(key: string): Promise<string | null> {
        try {
            const [content] = await this.storage.bucket(this.bucket).file(key).download();
            return content.toString("utf-8");
        } catch (err: any) {
            if (err.code === 404) return null;
            throw err;
        }
    }

    async putFile(key: string, content: string): Promise<void> {
        const contentType = key.endsWith(".json") ? "application/json" : "text/yaml";
        await this.storage.bucket(this.bucket).file(key).save(content, { contentType });
    }

    async deleteFile(key: string): Promise<void> {
        await this.storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
    }
}
