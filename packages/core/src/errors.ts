// SPDX-License-Identifier: AGPL-3.0-only

export class AgentRunError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class NotFoundError extends AgentRunError {}
export class BadRequestError extends AgentRunError {}
export class ForbiddenError extends AgentRunError {}
export class UnauthorizedError extends AgentRunError {}

/**
 * Raised by authenticated executors when no per-user token is available
 * for the requested provider. Channels pattern-match on this error type
 * to convert it into a client-appropriate "connect your account" prompt.
 *
 * No global fallback is supported by design — if the user has not
 * connected their account, the call must fail explicitly so the audit
 * trail unambiguously identifies the human caller.
 */
export class MissingUserTokenError extends AgentRunError {
    readonly code = "MISSING_USER_TOKEN";

    constructor(public readonly provider: string) {
        super(`Missing user token for provider: ${provider}`);
    }
}
