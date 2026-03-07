// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import { MarkdownIngester } from "@agentrun-ai/core";

// Lazy-load AWS SDK
async function loadBedrockSdk() {
    const sdk = await import("@aws-sdk/client-bedrock-runtime");
    return { BedrockRuntimeClient: sdk.BedrockRuntimeClient, InvokeModelCommand: sdk.InvokeModelCommand };
}

async function loadRdsDataSdk() {
    const sdk = await import("@aws-sdk/client-rds-data");
    return { RDSDataClient: sdk.RDSDataClient, ExecuteStatementCommand: sdk.ExecuteStatementCommand };
}

async function loadBedrockAgentSdk() {
    const sdk = await import("@aws-sdk/client-bedrock-agent");
    return { BedrockAgentClient: sdk.BedrockAgentClient, StartIngestionJobCommand: sdk.StartIngestionJobCommand, GetIngestionJobCommand: sdk.GetIngestionJobCommand };
}

async function loadS3Sdk() {
    const sdk = await import("@aws-sdk/client-s3");
    return { S3Client: sdk.S3Client, PutObjectCommand: sdk.PutObjectCommand };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
    file: string;
    source: string;
    clusterArn: string;
    secretArn: string;
    database: string;
    schema: string;
    region: string;
    embeddingModel: string;
    dimensions: number;
    maxTokens: number;
    overlap: number;
    dryRun: boolean;
}

export interface BedrockKBIngestOptions {
    file: string;
    bucket: string;
    key: string;
    knowledgeBaseId: string;
    dataSourceId: string;
    region: string;
    dryRun: boolean;
}

export interface IngestResult {
    chunks: number;
    embedded: number;
    upserted: number;
    totalTokens: number;
}

// ---------------------------------------------------------------------------
// Embedding via Bedrock
// ---------------------------------------------------------------------------

async function embedText(
    client: any,
    InvokeModelCommand: any,
    text: string,
    modelId: string,
    dimensions: number,
): Promise<{ vector: number[]; tokens: number }> {
    const body = JSON.stringify({ inputText: text, dimensions });
    const response = await client.send(
        new InvokeModelCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: new TextEncoder().encode(body),
        }),
    );

    const parsed = JSON.parse(new TextDecoder().decode(response.body));
    return {
        vector: parsed.embedding,
        tokens: parsed.inputTextTokenCount ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Upsert via Data API
// ---------------------------------------------------------------------------

async function upsertChunk(
    rdsClient: any,
    ExecuteStatementCommand: any,
    opts: { clusterArn: string; secretArn: string; database: string; schema: string },
    chunk: { id: string; content: string; metadata: Record<string, string>; vector: number[] },
): Promise<void> {
    const vectorStr = `[${chunk.vector.join(",")}]`;

    await rdsClient.send(
        new ExecuteStatementCommand({
            resourceArn: opts.clusterArn,
            secretArn: opts.secretArn,
            database: opts.database,
            sql: `
                INSERT INTO ${opts.schema}.knowledge_chunks (id, content, metadata, embedding)
                VALUES (:id, :content, :metadata::jsonb, :embedding::vector)
                ON CONFLICT (id) DO UPDATE
                SET content = :content, metadata = :metadata::jsonb,
                    embedding = :embedding::vector
            `,
            parameters: [
                { name: "id", value: { stringValue: chunk.id } },
                { name: "content", value: { stringValue: chunk.content } },
                { name: "metadata", value: { stringValue: JSON.stringify(chunk.metadata) } },
                { name: "embedding", value: { stringValue: vectorStr } },
            ],
        }),
    );
}

// ---------------------------------------------------------------------------
// Main ingest function
// ---------------------------------------------------------------------------

export async function ingestDocument(opts: IngestOptions): Promise<IngestResult> {
    // Read the document
    const filePath = path.resolve(opts.file);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    console.log(`  File: ${filePath} (${content.length} chars)`);

    // Chunk the document
    const ingester = new MarkdownIngester(opts.maxTokens, opts.overlap);
    const chunks = ingester.chunk(opts.source, content);
    console.log(`  Chunks: ${chunks.length}`);

    if (opts.dryRun) {
        console.log("\n  [DRY RUN] Chunks that would be ingested:\n");
        for (const chunk of chunks) {
            const preview = chunk.content.slice(0, 80).replace(/\n/g, " ");
            console.log(`    ${chunk.id}  ${chunk.metadata.heading || "(no heading)"}  ${preview}...`);
        }
        return { chunks: chunks.length, embedded: 0, upserted: 0, totalTokens: 0 };
    }

    // Load SDKs
    const { BedrockRuntimeClient, InvokeModelCommand } = await loadBedrockSdk();
    const { RDSDataClient, ExecuteStatementCommand } = await loadRdsDataSdk();

    const bedrockClient = new BedrockRuntimeClient({ region: opts.region });
    const rdsClient = new RDSDataClient({ region: opts.region });

    let totalTokens = 0;
    let embedded = 0;
    let upserted = 0;

    // Process chunks in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const progress = `${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`;
        process.stdout.write(`  Embedding + upserting batch ${progress}...`);

        // Embed all chunks in parallel
        const embedResults = await Promise.all(
            batch.map((chunk) =>
                embedText(bedrockClient, InvokeModelCommand, chunk.content, opts.embeddingModel, opts.dimensions),
            ),
        );

        // Upsert all chunks in parallel
        await Promise.all(
            batch.map((chunk, idx) =>
                upsertChunk(rdsClient, ExecuteStatementCommand, opts, {
                    id: chunk.id,
                    content: chunk.content,
                    metadata: chunk.metadata,
                    vector: embedResults[idx].vector,
                }),
            ),
        );

        for (const r of embedResults) {
            totalTokens += r.tokens;
        }
        embedded += batch.length;
        upserted += batch.length;

        console.log(" done");
    }

    return { chunks: chunks.length, embedded, upserted, totalTokens };
}

// ---------------------------------------------------------------------------
// Bedrock Knowledge Base ingest (upload to S3 + trigger ingestion job)
// ---------------------------------------------------------------------------

export interface BedrockKBIngestResult {
    uploaded: boolean;
    ingestionJobId: string | null;
    status: string;
}

export async function ingestBedrockKB(opts: BedrockKBIngestOptions): Promise<BedrockKBIngestResult> {
    const filePath = path.resolve(opts.file);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    console.log(`  File: ${filePath} (${content.length} chars)`);
    console.log(`  Target: s3://${opts.bucket}/${opts.key}`);

    if (opts.dryRun) {
        console.log("\n  [DRY RUN] Would upload file and trigger ingestion job");
        return { uploaded: false, ingestionJobId: null, status: "dry-run" };
    }

    // Upload to S3
    const { S3Client, PutObjectCommand } = await loadS3Sdk();
    const s3 = new S3Client({ region: opts.region });
    await s3.send(new PutObjectCommand({
        Bucket: opts.bucket,
        Key: opts.key,
        Body: content,
        ContentType: "text/markdown",
    }));
    console.log("  Uploaded to S3");

    // Trigger ingestion job
    const { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } = await loadBedrockAgentSdk();
    const agent = new BedrockAgentClient({ region: opts.region });

    const startResponse = await agent.send(new StartIngestionJobCommand({
        knowledgeBaseId: opts.knowledgeBaseId,
        dataSourceId: opts.dataSourceId,
    }));

    const jobId = startResponse.ingestionJob?.ingestionJobId ?? null;
    console.log(`  Ingestion job started: ${jobId}`);

    // Poll for completion (max 5 min)
    if (jobId) {
        for (let i = 0; i < 30; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10000));

            const statusResponse = await agent.send(new GetIngestionJobCommand({
                knowledgeBaseId: opts.knowledgeBaseId,
                dataSourceId: opts.dataSourceId,
                ingestionJobId: jobId,
            }));

            const status = statusResponse.ingestionJob?.status ?? "UNKNOWN";
            console.log(`  Status: ${status} (${i + 1}/30)`);

            if (status === "COMPLETE") {
                return { uploaded: true, ingestionJobId: jobId, status: "COMPLETE" };
            }
            if (status === "FAILED") {
                const reason = statusResponse.ingestionJob?.failureReasons?.join(", ") ?? "unknown";
                throw new Error(`Ingestion failed: ${reason}`);
            }
        }

        return { uploaded: true, ingestionJobId: jobId, status: "TIMEOUT" };
    }

    return { uploaded: true, ingestionJobId: null, status: "STARTED" };
}
