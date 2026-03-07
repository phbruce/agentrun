// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@agentrun-ai/core";

/**
 * Resolve the Slack bot token from environment.
 * Consumers must set SLACK_BOT_TOKEN (or provide via a secret provider).
 */
function getSlackToken(): string | undefined {
    return process.env.SLACK_BOT_TOKEN || undefined;
}

export interface SlackPostPayload {
    channel?: string;
    text?: string;
    blocks?: any[];
    response_type?: "ephemeral" | "in_channel";
    replace_original?: boolean;
}

export async function postToResponseUrl(responseUrl: string, payload: SlackPostPayload): Promise<void> {
    const res = await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        logger.error({ status: res.status, body: await res.text() }, "Slack response_url post failed");
    }
}

export async function postMessage(channel: string, text: string, blocks?: any[]): Promise<void> {
    const token = getSlackToken();
    if (!token) {
        logger.error("SLACK_BOT_TOKEN not set");
        return;
    }
    const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel, text, blocks }),
    });
    if (!res.ok) {
        logger.error({ status: res.status }, "Slack postMessage failed");
    }
}

export async function postThreadMessage(
    channel: string,
    threadTs: string,
    text: string,
    blocks?: any[],
): Promise<string | undefined> {
    const token = getSlackToken();
    if (!token) {
        logger.error("SLACK_BOT_TOKEN not set");
        return undefined;
    }
    const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel, text, blocks, thread_ts: threadTs }),
    });
    if (!res.ok) {
        logger.error({ status: res.status }, "Slack postThreadMessage failed");
        return undefined;
    }
    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
        logger.error({ error: data.error }, "Slack postThreadMessage API error");
        return undefined;
    }
    return data.ts;
}

export async function getUserProfileImage(userId: string): Promise<string | undefined> {
    const token = getSlackToken();
    if (!token) return undefined;
    try {
        const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as { ok: boolean; user?: { profile?: { image_48?: string } } };
        return data.ok ? data.user?.profile?.image_48 : undefined;
    } catch {
        return undefined;
    }
}

export async function addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    const token = getSlackToken();
    if (!token) {
        logger.error("SLACK_BOT_TOKEN not set — cannot add reaction");
        return;
    }
    try {
        const res = await fetch("https://slack.com/api/reactions.add", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ channel, timestamp, name }),
        });
        if (!res.ok) {
            logger.warn({ status: res.status }, "Slack reactions.add HTTP error");
        }
    } catch (e: any) {
        logger.warn({ error: e.message }, "Slack reactions.add failed");
    }
}
