// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Typed Slack event envelopes.
 *
 * Slack's Events API delivers all events as JSON with a discriminator
 * at `event.type`. Consumers that parse the raw POST body into these
 * types get exhaustiveness checking on the dispatch site and stop
 * defaulting to `any`.
 *
 * This is intentionally narrow — only the fields the agent runtime
 * cares about are modeled. Slack's full event surface is much wider;
 * unknown fields still pass through (each interface has an index
 * signature) so consumers can read what they need without a forced
 * upgrade when Slack adds a field.
 */

export interface SlackEventEnvelope<E extends SlackEvent = SlackEvent> {
    token?: string;
    team_id?: string;
    api_app_id?: string;
    event: E;
    type: "event_callback" | "url_verification";
    event_id?: string;
    event_time?: number;
    [key: string]: unknown;
}

export type SlackEvent =
    | SlackMessageEvent
    | SlackAppMentionEvent
    | SlackAppHomeOpenedEvent
    | SlackUnknownEvent;

export interface SlackMessageEvent {
    type: "message";
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
    [key: string]: unknown;
}

export interface SlackAppMentionEvent {
    type: "app_mention";
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    [key: string]: unknown;
}

export interface SlackAppHomeOpenedEvent {
    type: "app_home_opened";
    user?: string;
    channel?: string;
    tab?: "home" | "messages";
    [key: string]: unknown;
}

export interface SlackUnknownEvent {
    type: string;
    [key: string]: unknown;
}

/**
 * URL verification handshake. Slack sends one of these the first time
 * an Events API webhook is registered. The handler must echo back the
 * `challenge` string.
 */
export interface SlackUrlVerification {
    type: "url_verification";
    token?: string;
    challenge: string;
}

/** Type guard for the URL verification handshake. */
export function isUrlVerification(payload: unknown): payload is SlackUrlVerification {
    return (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "url_verification" &&
        typeof (payload as { challenge?: unknown }).challenge === "string"
    );
}

/** Type guard for an event callback envelope. */
export function isEventCallback(payload: unknown): payload is SlackEventEnvelope {
    return (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "event_callback" &&
        typeof (payload as { event?: unknown }).event === "object"
    );
}
