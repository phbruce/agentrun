// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from "@jest/globals";
import { SseEventStream } from "./sse.js";
import type { ByteSink } from "./sse.js";

class CapturingSink implements ByteSink {
    chunks: string[] = [];
    ended = false;
    write(chunk: string): boolean {
        this.chunks.push(chunk);
        return true;
    }
    end(): void {
        this.ended = true;
    }
    get joined(): string {
        return this.chunks.join("");
    }
}

let sink: CapturingSink;
let now: number;
const fixedNow = () => now;

beforeEach(() => {
    sink = new CapturingSink();
    now = 1700000000000;
});

describe("SseEventStream — framing", () => {
    it("emits a comment preamble on open", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        expect(sink.joined).toBe(`: opened at ${now}\n\n`);
    });

    it("frames endpoint events with the SSE event field", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        sink.chunks = [];
        stream.sendEndpoint("/messages/abc");
        expect(sink.joined).toBe("event: endpoint\ndata: /messages/abc\n\n");
    });

    it("frames JSON-RPC responses as message events", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        sink.chunks = [];
        stream.sendMessage({ jsonrpc: "2.0", id: 1, result: { ok: true } });
        expect(sink.joined).toBe(
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
        );
    });

    it("frames notifications (no id) as message events", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        sink.chunks = [];
        stream.sendMessage({ jsonrpc: "2.0", method: "tools/listChanged" });
        expect(sink.joined).toBe(
            'event: message\ndata: {"jsonrpc":"2.0","method":"tools/listChanged"}\n\n',
        );
    });

    it("splits multi-line JSON onto separate data: lines", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        sink.chunks = [];
        // Hand-build a payload with an embedded newline; not standard
        // JSON-RPC, but the SSE frame must remain valid in any case.
        const body = `multi
line`;
        stream.send({ type: "endpoint", uri: body });
        expect(sink.joined).toBe("event: endpoint\ndata: multi\ndata: line\n\n");
    });

    it("ping emits a comment frame", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        sink.chunks = [];
        stream.ping();
        expect(sink.joined).toBe(`: keep-alive ${now}\n\n`);
    });
});

describe("SseEventStream — lifecycle", () => {
    it("close() flushes the underlying sink", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        stream.close();
        expect(sink.ended).toBe(true);
    });

    it("rejects sends after close", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        stream.close();
        expect(() => stream.sendEndpoint("/x")).toThrow(/closed/);
    });

    it("close() is idempotent", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        stream.close();
        expect(() => stream.close()).not.toThrow();
    });

    it("ping() after close is a silent no-op", () => {
        const stream = new SseEventStream(sink, { keepAliveMs: 0, now: fixedNow });
        stream.open();
        stream.close();
        sink.chunks = [];
        stream.ping();
        expect(sink.joined).toBe("");
    });
});
