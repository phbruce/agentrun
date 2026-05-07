// SPDX-License-Identifier: AGPL-3.0-only

import type { JsonRpcRequest, JsonRpcResponse } from "@agentrun-ai/core";

/**
 * MCP over Server-Sent Events.
 *
 * The MCP spec supports SSE as a streaming transport: a long-lived GET
 * to /sse keeps a server-pushed event stream open while the client
 * POSTs requests to a paired endpoint. This file ships a transport-
 * agnostic primitive (`SseEventStream`) that callers can wire to any
 * writable byte sink — Node `http.ServerResponse`, Fastify reply,
 * Web `WritableStream`, etc. — and use to emit MCP messages.
 *
 * Notifications (no `id`) and responses (with `id`) share the same
 * `data: <json>\n\n` framing. The SSE `event:` field is used to type
 * the message so clients can dispatch without parsing the JSON body.
 */

export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
}

export type McpStreamMessage =
    | { type: "endpoint"; uri: string }
    | { type: "message"; payload: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification };

/**
 * Minimal contract a downstream byte sink must satisfy. Both
 * `http.ServerResponse` and a Fastify reply satisfy this implicitly.
 */
export interface ByteSink {
    write(chunk: string): boolean | void;
    end?(): void;
}

export interface SseEventStreamOptions {
    /** Comment frames are emitted every keepAliveMs to prevent proxies from idling out. */
    keepAliveMs?: number;
    /** Optional clock override for deterministic tests. */
    now?: () => number;
}

const DEFAULT_KEEP_ALIVE_MS = 25_000;

/**
 * Adapter that frames MCP messages as SSE events on top of any
 * `ByteSink`. Callers own the lifecycle of the underlying response.
 */
export class SseEventStream {
    private readonly sink: ByteSink;
    private readonly keepAliveMs: number;
    private readonly now: () => number;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    private closed = false;

    constructor(sink: ByteSink, opts: SseEventStreamOptions = {}) {
        this.sink = sink;
        this.keepAliveMs = opts.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
        this.now = opts.now ?? (() => Date.now());
    }

    /**
     * Emit the SSE preamble. Most callers should run this once after
     * the underlying response has its headers flushed (Content-Type:
     * text/event-stream, Cache-Control: no-cache, Connection: keep-alive).
     */
    open(): void {
        if (this.closed) throw new Error("SseEventStream: already closed");
        // Initial comment to commit the response so reverse proxies don't
        // buffer the headers.
        this.sink.write(`: opened at ${this.now()}\n\n`);
        if (this.keepAliveMs > 0) {
            this.keepAliveTimer = setInterval(() => this.ping(), this.keepAliveMs);
            // Don't keep the event loop alive solely for keep-alive pings.
            (this.keepAliveTimer as unknown as { unref?: () => void }).unref?.();
        }
    }

    /** Send the spec's `endpoint` event so the client knows where to POST requests. */
    sendEndpoint(uri: string): void {
        this.send({ type: "endpoint", uri });
    }

    /** Send an MCP message (request, response, or notification). */
    sendMessage(payload: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
        this.send({ type: "message", payload });
    }

    /** Lower-level emit; consumers can call directly when they need to. */
    send(msg: McpStreamMessage): void {
        if (this.closed) throw new Error("SseEventStream: closed");
        const body = msg.type === "endpoint" ? msg.uri : JSON.stringify(msg.payload);
        this.sink.write(`event: ${msg.type}\n`);
        for (const line of body.split("\n")) {
            this.sink.write(`data: ${line}\n`);
        }
        this.sink.write("\n");
    }

    /** Comment frame; advisory keep-alive. */
    ping(): void {
        if (this.closed) return;
        this.sink.write(`: keep-alive ${this.now()}\n\n`);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
        this.sink.end?.();
    }
}
