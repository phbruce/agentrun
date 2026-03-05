// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "../logger.js";
import type { SecretProvider, SecretDeclaration, ResolvedSecrets } from "./types.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
    secrets: ResolvedSecrets;
    expiresAt: number;
}

export class SecretResolver {
    private providers = new Map<string, SecretProvider>();
    private cache = new Map<string, CacheEntry>();

    registerProvider(provider: SecretProvider): void {
        this.providers.set(provider.name, provider);
    }

    async resolveForPack(packName: string, declarations: SecretDeclaration[]): Promise<ResolvedSecrets> {
        if (declarations.length === 0) return new Map();

        // Check cache
        const cached = this.cache.get(packName);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.secrets;
        }

        try {
            const resolved = await this.fetchSecrets(declarations);

            this.cache.set(packName, {
                secrets: resolved,
                expiresAt: Date.now() + CACHE_TTL_MS,
            });

            return resolved;
        } catch (err: any) {
            logger.error({ packName, error: err.message }, "Failed to resolve secrets for pack");
            // Serve stale cache on error
            if (cached) return cached.secrets;
            throw err;
        }
    }

    clearCache(): void {
        this.cache.clear();
    }

    private async fetchSecrets(declarations: SecretDeclaration[]): Promise<ResolvedSecrets> {
        // Group declarations by provider
        const byProvider = new Map<string, SecretDeclaration[]>();
        for (const decl of declarations) {
            const group = byProvider.get(decl.provider) ?? [];
            group.push(decl);
            byProvider.set(decl.provider, group);
        }

        // Resolve each provider group in parallel
        const results = new Map<string, string>();
        const providerPromises: Promise<void>[] = [];

        for (const [providerName, decls] of byProvider) {
            const provider = this.providers.get(providerName);
            if (!provider) {
                logger.warn({ provider: providerName }, "Unknown secret provider, skipping");
                continue;
            }

            providerPromises.push(
                (async () => {
                    const paths = decls.map((d) => d.path);
                    const values = await provider.getMany(paths);

                    // Map path-based results back to logical names
                    for (const decl of decls) {
                        const value = values.get(decl.path);
                        if (value !== undefined) {
                            results.set(decl.name, value);
                        } else {
                            logger.warn(
                                { name: decl.name, path: decl.path, provider: providerName },
                                "Secret not found"
                            );
                        }
                    }
                })()
            );
        }

        await Promise.all(providerPromises);
        return results;
    }
}
