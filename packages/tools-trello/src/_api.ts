// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";

const BASE_URL = "https://api.trello.com/1";

type Params = Record<string, string | number | boolean | undefined>;

function query(params?: Params): string {
    if (!params) return "";
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
}

export interface TrelloCredentials {
    apiKey: string;
    token: string;
}

/**
 * Returns the API key + token to use for the current call, or null when the
 * caller has none. Hosts that act on behalf of several people register one
 * that looks up the caller's own credentials, so every Trello action is done
 * (and shows up in Trello) as that person.
 */
export type TrelloCredentialsResolver = () => TrelloCredentials | null | Promise<TrelloCredentials | null>;

/** Raised when no Trello credentials are available for the current caller. */
export class TrelloNotConnectedError extends Error {
    constructor(message = "Trello credentials not configured for this user") {
        super(message);
        this.name = "TrelloNotConnectedError";
    }
}

const envCredentials: TrelloCredentialsResolver = () => {
    const apiKey = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    return apiKey && token ? { apiKey, token } : null;
};

let resolveCredentials: TrelloCredentialsResolver = envCredentials;

/**
 * Replace how credentials are found. The default reads TRELLO_API_KEY and
 * TRELLO_TOKEN from the environment (single user); pass null to restore it.
 */
export function setTrelloCredentialsResolver(resolver: TrelloCredentialsResolver | null): void {
    resolveCredentials = resolver ?? envCredentials;
}

/**
 * Call the Trello REST API with the credentials of the current caller.
 * Credentials go in the OAuth Authorization header (supported by Trello),
 * never in the URL, so they stay out of access logs.
 */
export async function trelloApi(method: string, path: string, params?: Params, body?: Record<string, unknown>): Promise<any> {
    const creds = await resolveCredentials();
    if (!creds) {
        throw new TrelloNotConnectedError();
    }

    const res = await fetch(`${BASE_URL}${path}${query(params)}`, {
        method,
        headers: {
            Authorization: `OAuth oauth_consumer_key="${creds.apiKey}", oauth_token="${creds.token}"`,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
        const text = await res.text();
        logger.error({ status: res.status, method, path, body: text }, "Trello API error");
        throw new Error(`Trello API ${res.status}: ${text}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

/** Drop undefined fields so PUT/POST bodies only carry what the caller set. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function textResult(data: unknown) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
}

export const CARD_FIELDS = "name,desc,idList,idBoard,due,dueComplete,closed,labels,idMembers,shortUrl,dateLastActivity,pos";

/** Compact view of a card for list/search results. */
export function summarizeCard(c: any) {
    return {
        id: c.id,
        name: c.name,
        idList: c.idList,
        idBoard: c.idBoard,
        due: c.due ?? null,
        dueComplete: c.dueComplete ?? false,
        closed: c.closed ?? false,
        labels: (c.labels ?? []).map((l: any) => l.name || l.color),
        idMembers: c.idMembers ?? [],
        url: c.shortUrl ?? c.url,
        lastActivity: c.dateLastActivity,
    };
}
