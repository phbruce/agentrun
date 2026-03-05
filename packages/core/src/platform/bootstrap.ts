// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "../logger.js";
import { PlatformRegistry } from "./registry.js";
import { loadPlatformConfig, buildDefaultConfig } from "./config.js";
import type { PlatformConfig } from "./types.js";

/**
 * Provider registration function type.
 * Implementations (e.g., @agentrun-oss/aws) register concrete providers.
 */
export type ProviderRegistrar = (config: PlatformConfig) => void;

let _bootstrapped = false;
let _registrar: ProviderRegistrar | null = null;

/**
 * Set the provider registrar function.
 * Must be called before bootstrapPlatform().
 *
 * Example:
 *   import { registerAwsProviders } from "@agentrun-oss/aws";
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

    if (_registrar) {
        _registrar(config);
    } else {
        logger.warn("No provider registrar set. Call setProviderRegistrar() before bootstrapPlatform().");
        // Still store config in registry even without providers
        PlatformRegistry.instance().setConfig(config);
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
