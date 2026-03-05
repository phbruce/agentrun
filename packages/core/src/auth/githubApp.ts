// SPDX-License-Identifier: AGPL-3.0-only
import jwt from "jsonwebtoken";
import { logger } from "../logger.js";

let cachedToken: { token: string; expiresAt: number } | null = null;

function generateAppJwt(): string {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
        throw new Error("GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not set");
    }

    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ iss: Number(appId), iat: now - 60, exp: now + 600 }, privateKey, { algorithm: "RS256" });
}

export async function getInstallationToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - now > 5 * 60 * 1000) {
        return cachedToken.token;
    }

    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
    if (!installationId) {
        throw new Error("GITHUB_APP_INSTALLATION_ID not set");
    }

    const appJwt = generateAppJwt();
    const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${appJwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });

    if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "Failed to get GitHub installation token");
        throw new Error(`GitHub App token error ${res.status}: ${body}`);
    }

    const data = await res.json() as { token: string; expires_at: string };
    cachedToken = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
    logger.info({ expiresAt: data.expires_at }, "GitHub App installation token obtained");
    return data.token;
}
