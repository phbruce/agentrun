// SPDX-License-Identifier: AGPL-3.0-only

import { PlatformRegistry } from "./registry.js";

const BUILTIN_DEFAULT = "us.anthropic.claude-sonnet-4-20250514-v1:0";
const BUILTIN_COMPLEX = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export function getModels(): { defaultModel: string; complexModel: string } {
    const fallbackDefault = process.env.AGENTRUN_DEFAULT_MODEL ?? BUILTIN_DEFAULT;
    const fallbackComplex = process.env.AGENTRUN_COMPLEX_MODEL ?? BUILTIN_COMPLEX;
    try {
        const registry = PlatformRegistry.instance();
        if (registry.isConfigured) {
            const llmConfig = registry.config.spec.providers.llm.config;
            return {
                defaultModel: (llmConfig.defaultModel as string) ?? fallbackDefault,
                complexModel: (llmConfig.complexModel as string) ?? fallbackComplex,
            };
        }
    } catch { /* not configured */ }
    return { defaultModel: fallbackDefault, complexModel: fallbackComplex };
}
