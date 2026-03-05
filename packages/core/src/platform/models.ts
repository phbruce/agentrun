// SPDX-License-Identifier: AGPL-3.0-only

import { PlatformRegistry } from "./registry.js";

const FALLBACK_DEFAULT = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const FALLBACK_COMPLEX = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export function getModels(): { defaultModel: string; complexModel: string } {
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const llmConfig = registry.config.spec.providers.llm.config;
            return {
                defaultModel: (llmConfig.defaultModel as string) ?? FALLBACK_DEFAULT,
                complexModel: (llmConfig.complexModel as string) ?? FALLBACK_COMPLEX,
            };
        }
    } catch { /* not configured */ }
    return { defaultModel: FALLBACK_DEFAULT, complexModel: FALLBACK_COMPLEX };
}
