// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Slash command router.
 *
 * Slack POSTs slash command invocations as `application/x-www-form-urlencoded`
 * with the fields modeled in `SlashCommandPayload`. The router maps a
 * command name (with or without leading slash) to a handler that
 * receives the parsed payload and returns a Slack response payload.
 *
 * The router stays transport-agnostic: callers parse the form body
 * (e.g., via `URLSearchParams` from a Fastify or Express body-parser),
 * convert to `SlashCommandPayload`, and pass it to `dispatch()`. Socket
 * Mode delivers slash commands via WebSocket; consumers convert the
 * Socket Mode `body` (already an object) into the same payload shape
 * before dispatching.
 */

export interface SlashCommandPayload {
    /** Slack-issued token (verification deprecated; signing secret preferred). */
    token?: string;
    /** Workspace identifier. */
    team_id: string;
    team_domain?: string;
    enterprise_id?: string;
    enterprise_name?: string;
    /** The channel the command was invoked from. */
    channel_id: string;
    channel_name?: string;
    /** The user who invoked the command. */
    user_id: string;
    user_name?: string;
    /** Command including the leading slash (`/command`). */
    command: string;
    /** Free-form text after the command. */
    text: string;
    response_url: string;
    trigger_id: string;
    api_app_id?: string;
    is_enterprise_install?: string;
}

export interface SlashCommandResponse {
    response_type?: "in_channel" | "ephemeral";
    text?: string;
    blocks?: unknown[];
    [key: string]: unknown;
}

export type SlashCommandHandler = (
    payload: SlashCommandPayload,
) => Promise<SlashCommandResponse | void> | SlashCommandResponse | void;

/**
 * Parse a URL-encoded form body into a typed slash command payload.
 * Slack always sends the canonical fields; missing required fields
 * cause a thrown error so consumers don't silently dispatch on
 * malformed input.
 */
export function parseSlashCommandBody(formBody: string | URLSearchParams): SlashCommandPayload {
    const params = typeof formBody === "string" ? new URLSearchParams(formBody) : formBody;
    const required = ["team_id", "channel_id", "user_id", "command", "text", "response_url", "trigger_id"];
    for (const key of required) {
        if (!params.has(key)) {
            throw new Error(`SlashCommand: missing required field '${key}'`);
        }
    }
    const out: SlashCommandPayload = {
        team_id: params.get("team_id")!,
        channel_id: params.get("channel_id")!,
        user_id: params.get("user_id")!,
        command: params.get("command")!,
        text: params.get("text") ?? "",
        response_url: params.get("response_url")!,
        trigger_id: params.get("trigger_id")!,
    };
    const writable = out as unknown as Record<string, unknown>;
    for (const optional of ["token", "team_domain", "enterprise_id", "enterprise_name", "channel_name", "user_name", "api_app_id", "is_enterprise_install"]) {
        const v = params.get(optional);
        if (v !== null) writable[optional] = v;
    }
    return out;
}

/**
 * Routes slash commands to registered handlers. Command lookup is
 * case-sensitive and accepts either `/foo` or `foo` form (the leading
 * slash is normalized away).
 */
export class SlashCommandRouter {
    private readonly handlers = new Map<string, SlashCommandHandler>();

    register(command: string, handler: SlashCommandHandler): void {
        const key = normalize(command);
        if (this.handlers.has(key)) {
            throw new Error(`SlashCommandRouter: '${key}' already registered`);
        }
        this.handlers.set(key, handler);
    }

    has(command: string): boolean {
        return this.handlers.has(normalize(command));
    }

    list(): readonly string[] {
        return Array.from(this.handlers.keys());
    }

    async dispatch(payload: SlashCommandPayload): Promise<SlashCommandResponse | void> {
        const handler = this.handlers.get(normalize(payload.command));
        if (!handler) {
            return {
                response_type: "ephemeral",
                text: `Unknown command: ${payload.command}. Available: ${this.list().map((c) => `/${c}`).join(", ")}`,
            };
        }
        return handler(payload);
    }
}

function normalize(command: string): string {
    return command.startsWith("/") ? command.slice(1) : command;
}
