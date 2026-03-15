// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";
import { createSign } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GChatCard {
    header?: { title: string; subtitle?: string; imageUrl?: string };
    sections: GChatSection[];
}

export interface GChatSection {
    header?: string;
    widgets: GChatWidget[];
}

export type GChatWidget =
    | { textParagraph: { text: string } }
    | { decoratedText: { topLabel: string; text: string } }
    | { divider: Record<string, never> }
    | { buttonList: { buttons: GChatButton[] } };

export interface GChatButton {
    text: string;
    onClick: {
        openLink?: { url: string };
        action?: {
            actionMethodName: string;
            parameters: { key: string; value: string }[];
        };
    };
}

interface GChatMessage {
    name?: string;
    text?: string;
    cardsV2?: { cardId: string; card: GChatCard }[];
    thread?: { name: string };
}

// ---------------------------------------------------------------------------
// OAuth2 token cache (service account JWT → access token)
// ---------------------------------------------------------------------------

const BASE_URL = "https://chat.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chat.bot";
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min (tokens expire in 60 min)

let cachedToken: { token: string; expiresAt: number } | null = null;

interface ServiceAccountKey {
    client_email: string;
    private_key: string;
    token_uri?: string;
}

function getServiceAccountKey(): ServiceAccountKey | undefined {
    const raw = process.env.GCHAT_SERVICE_ACCOUNT_KEY;
    if (!raw) {
        logger.error("GCHAT_SERVICE_ACCOUNT_KEY env var is not set");
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as ServiceAccountKey;
        logger.info({ email: parsed.client_email }, "GChat service account loaded");
        return parsed;
    } catch (e) {
        logger.error({ err: (e as Error).message, length: raw.length }, "GCHAT_SERVICE_ACCOUNT_KEY is not valid JSON");
        return undefined;
    }
}

function createJwt(sa: ServiceAccountKey): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({
            iss: sa.client_email,
            scope: SCOPE,
            aud: sa.token_uri ?? TOKEN_URL,
            iat: now,
            exp: now + 3600,
        }),
    ).toString("base64url");

    const unsigned = `${header}.${payload}`;
    const sign = createSign("RSA-SHA256");
    sign.update(unsigned);
    const signature = sign.sign(sa.private_key, "base64url");

    return `${unsigned}.${signature}`;
}

async function getAccessToken(): Promise<string | undefined> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.token;
    }

    const sa = getServiceAccountKey();
    if (!sa) {
        logger.error("GCHAT_SERVICE_ACCOUNT_KEY not set");
        return undefined;
    }

    const jwt = createJwt(sa);
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
        }),
    });

    if (!res.ok) {
        logger.error({ status: res.status, body: await res.text() }, "Google OAuth2 token exchange failed");
        return undefined;
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + TOKEN_TTL_MS,
    };

    return cachedToken.token;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiRequest(method: string, path: string, body?: unknown): Promise<any> {
    const token = await getAccessToken();
    if (!token) return undefined;

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
        logger.error({ status: res.status, path, body: await res.text() }, "Google Chat API request failed");
        return undefined;
    }

    return res.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a plain text message to a Google Chat space.
 * Returns the created message (includes `name` for later updates).
 */
export async function postMessage(
    spaceId: string,
    text: string,
    threadName?: string,
): Promise<GChatMessage | undefined> {
    const body: Record<string, unknown> = { text };
    if (threadName) {
        body.thread = { name: threadName };
    }
    const queryParams = threadName ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
    // spaceId comes as "spaces/XXXXX" from Google Chat events
    // The Chat API v1 expects: /v1/spaces/{spaceId}/messages
    // BASE_URL already includes /v1, so we need /spaces/{id}/messages
    const normalizedSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    return apiRequest("POST", `/${normalizedSpace}/messages${queryParams}`, body) as Promise<GChatMessage | undefined>;
}

/**
 * Update an existing message's text content.
 */
export async function updateMessage(messageName: string, text: string): Promise<GChatMessage | undefined> {
    const normalizedName = messageName.startsWith("spaces/") ? messageName : `spaces/${messageName}`;
    return apiRequest("PATCH", `/${normalizedName}?updateMask=text`, { text }) as Promise<GChatMessage | undefined>;
}

/**
 * Delete a message.
 */
export async function deleteMessage(messageName: string): Promise<void> {
    const normalizedName = messageName.startsWith("spaces/") ? messageName : `spaces/${messageName}`;
    await apiRequest("DELETE", `/${normalizedName}`);
}

/**
 * Send a card message to a Google Chat space.
 */
export async function createCardMessage(
    spaceId: string,
    card: GChatCard,
    threadName?: string,
): Promise<GChatMessage | undefined> {
    const body: Record<string, unknown> = {
        cardsV2: [{ cardId: "agentrun-response", card }],
    };
    if (threadName) {
        body.thread = { name: threadName };
    }
    const queryParams = threadName ? "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : "";
    const normalizedSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    return apiRequest("POST", `/${normalizedSpace}/messages${queryParams}`, body) as Promise<GChatMessage | undefined>;
}
