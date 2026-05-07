// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import { isUrlVerification, isEventCallback } from "./events.js";

describe("Slack event guards", () => {
    it("isUrlVerification accepts a valid handshake", () => {
        expect(isUrlVerification({ type: "url_verification", challenge: "abc" })).toBe(true);
    });

    it("isUrlVerification rejects when fields are missing", () => {
        expect(isUrlVerification({ type: "url_verification" })).toBe(false);
        expect(isUrlVerification({ challenge: "abc" })).toBe(false);
        expect(isUrlVerification(null)).toBe(false);
        expect(isUrlVerification("string")).toBe(false);
    });

    it("isEventCallback accepts a well-formed envelope", () => {
        expect(
            isEventCallback({
                type: "event_callback",
                event: { type: "message", text: "hi" },
            }),
        ).toBe(true);
    });

    it("isEventCallback rejects mismatched type or missing event", () => {
        expect(isEventCallback({ type: "url_verification", challenge: "x" })).toBe(false);
        expect(isEventCallback({ type: "event_callback" })).toBe(false);
        expect(isEventCallback({ event: { type: "message" } })).toBe(false);
    });

    it("guards return false for primitives", () => {
        expect(isEventCallback(undefined)).toBe(false);
        expect(isUrlVerification(123)).toBe(false);
    });
});
