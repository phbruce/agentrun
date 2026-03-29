// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GCP Identity Token Resolver
 *
 * Fetches identity tokens from the GCP metadata server (Cloud Run, GCE, GKE)
 * or falls back to gcloud CLI for local development.
 *
 * Identity tokens are used for authenticated calls to Cloud Run services
 * and GenAI Gateway endpoints.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a GCP identity token for the given audience.
 * On Cloud Run, fetches from the metadata server (no SDK needed).
 * Caches the token with a 5-minute safety margin.
 */
export async function getIdentityToken(audience: string): Promise<string> {
    // Return cached token if still valid (5 min buffer)
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
        return cachedToken.token;
    }

    // Try metadata server first (Cloud Run / GCE / GKE)
    try {
        const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
        const res = await fetch(metadataUrl, {
            headers: { "Metadata-Flavor": "Google" },
            signal: AbortSignal.timeout(3000),
        });

        if (res.ok) {
            const token = await res.text();
            // Identity tokens from metadata server are valid for ~1 hour
            cachedToken = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
            return token;
        }
    } catch {
        // Not running on GCP — fall through to gcloud CLI
    }

    // Fallback: gcloud CLI (local development)
    try {
        const { execSync } = await import("node:child_process");
        const token = execSync(
            `gcloud auth print-identity-token --include-email 2>/dev/null`,
            { encoding: "utf-8", timeout: 10000 },
        ).trim();

        if (token) {
            cachedToken = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
            return token;
        }
    } catch {
        // gcloud not available
    }

    throw new Error("Cannot obtain GCP identity token. Are you running on GCP or logged in via gcloud?");
}
