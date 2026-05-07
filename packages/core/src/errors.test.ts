// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "@jest/globals";
import {
    AgentRunError,
    BadRequestError,
    ForbiddenError,
    MissingUserTokenError,
    NotFoundError,
    UnauthorizedError,
} from "./errors.js";

describe("AgentRunError hierarchy", () => {
    it("base error sets name to constructor name", () => {
        const e = new AgentRunError("boom");
        expect(e.name).toBe("AgentRunError");
        expect(e.message).toBe("boom");
        expect(e).toBeInstanceOf(Error);
    });

    it("subclasses set correct name", () => {
        expect(new NotFoundError("x").name).toBe("NotFoundError");
        expect(new BadRequestError("x").name).toBe("BadRequestError");
        expect(new ForbiddenError("x").name).toBe("ForbiddenError");
        expect(new UnauthorizedError("x").name).toBe("UnauthorizedError");
    });
});

describe("MissingUserTokenError", () => {
    it("carries a stable code and provider field", () => {
        const e = new MissingUserTokenError("jira");
        expect(e.code).toBe("MISSING_USER_TOKEN");
        expect(e.provider).toBe("jira");
        expect(e.message).toContain("jira");
    });

    it("is an AgentRunError instance", () => {
        const e = new MissingUserTokenError("gitlab");
        expect(e).toBeInstanceOf(AgentRunError);
        expect(e).toBeInstanceOf(Error);
    });

    it("name is the class name (for channel adapters that pattern-match)", () => {
        const e = new MissingUserTokenError("confluence");
        expect(e.name).toBe("MissingUserTokenError");
    });
});
