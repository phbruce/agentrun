// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../logger.js";
import { PlatformRegistry } from "./registry.js";
import { loadPlatformConfig, buildDefaultConfig } from "./config.js";
import type { PlatformConfig } from "./types.js";

/**
 * Provider registration function type.
 * Implementations (e.g., @agentrun-ai/aws) register concrete providers.
 */
export type ProviderRegistrar = (config: PlatformConfig) => void;

let _bootstrapped = false;
let _registrar: ProviderRegistrar | null = null;

/**
 * Set the provider registrar function.
 * Must be called before bootstrapPlatform().
 *
 * @deprecated Use the Platform plugin contract instead — pass a
 *   plugin function `(platform: Platform) => void` that calls
 *   `platform.registerProviders(...)`. The legacy registrar singleton
 *   only supports a single cloud at a time and will be removed in a
 *   future major release.
 *
 * Example (legacy):
 *   import { registerAwsProviders } from "@agentrun-ai/aws";
 *   setProviderRegistrar(registerAwsProviders);
 */
export function setProviderRegistrar(registrar: ProviderRegistrar): void {
    _registrar = registrar;
}

/**
 * Bootstrap the platform on cold start.
 * Safe to call multiple times — only runs once.
 */
export async function bootstrapPlatform(): Promise<void> {
    if (_bootstrapped) return;

    const config = await loadPlatformConfig() ?? buildDefaultConfig();

    // Always set config on this module's PlatformRegistry instance first.
    // The registrar (e.g. registerGcpProviders) may run from a different copy of
    // @agentrun-ai/core in nested node_modules and will set config on its own
    // singleton — but callers that import from this copy need it set here too.
    PlatformRegistry.instance().setConfig(config);

    if (_registrar) {
        _registrar(config);
    } else {
        logger.warn("No provider registrar set. Call setProviderRegistrar() before bootstrapPlatform().");
    }

    _bootstrapped = true;
    logger.info({ name: config.metadata.name }, "Platform bootstrapped");
}

/**
 * Check if the platform is already bootstrapped with a config.
 * If not, bootstrap with defaults synchronously.
 */
export function ensurePlatform(): PlatformRegistry {
    const registry = PlatformRegistry.instance();
    if (!registry.isConfigured) {
        const config = buildDefaultConfig();
        if (_registrar) {
            _registrar(config);
        } else {
            registry.setConfig(config);
        }
        _bootstrapped = true;
    }
    return registry;
}
