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
