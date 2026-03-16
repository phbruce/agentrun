// SPDX-License-Identifier: AGPL-3.0-only

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { ManifestStore } from "@agentrun-ai/core";

export class S3ManifestStore implements ManifestStore {
    private s3: S3Client;
    private bucket: string;

    constructor(bucket: string) {
        this.s3 = new S3Client({});
        this.bucket = bucket;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const res = await this.s3.send(new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
        }));

        return (res.Contents ?? [])
            .filter((obj) => obj.Key?.endsWith(".yaml") || obj.Key?.endsWith(".yml"))
            .map((obj) => obj.Key!);
    }

    async getFile(key: string): Promise<string | null> {
        try {
            const res = await this.s3.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            return await res.Body?.transformToString() ?? null;
        } catch (err: any) {
            if (err.name === "NoSuchKey") return null;
            throw err;
        }
    }

    async putFile(key: string, content: string): Promise<void> {
        await this.s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: content,
            ContentType: key.endsWith(".json") ? "application/json" : "text/yaml",
        }));
    }

    async deleteFile(key: string): Promise<void> {
        await this.s3.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
    }
}
