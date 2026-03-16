// SPDX-License-Identifier: AGPL-3.0-only
import type { Role, RoleConfig } from "./types.js";
import { PlatformRegistry } from "../platform/registry.js";

/** Build ROLE_CONFIGS from platform config. Falls back to empty if not configured. */
function loadRoleConfigs(): Record<string, RoleConfig> {
    const registry = PlatformRegistry.instance();
    if (!registry.isConfigured) return {};

    const configRoles = registry.config.spec.roles;
    const result: Record<string, RoleConfig> = {};

    for (const [roleName, def] of Object.entries(configRoles)) {
        result[roleName] = {
            allowedTools: [], // derived from catalog use-cases, not stored here
            allowedUseCases: def.useCases,
            persona: def.persona,
            capabilities: def.capabilities ?? "",
            maxTurns: def.maxTurns,
            maxBudgetUsd: def.maxBudgetUsd,
        };
    }

    return result;
}

/** Lazy-loaded, config-driven role configs. Rebuilt on each access if empty. */
let _roleConfigs: Record<string, RoleConfig> | null = null;

export function getRoleConfigs(): Record<string, RoleConfig> {
    if (!_roleConfigs || Object.keys(_roleConfigs).length === 0) {
        _roleConfigs = loadRoleConfigs();
    }
    return _roleConfigs;
}

/** Reset cached configs (for testing or config reload). */
export function resetRoleConfigs(): void {
    _roleConfigs = null;
}

/** Get ROLE_CONFIGS as a Record (backward compat — computed property). */
export const ROLE_CONFIGS = new Proxy({} as Record<Role, RoleConfig>, {
    get(_target, prop: string) {
        return getRoleConfigs()[prop];
    },
    has(_target, prop: string) {
        return prop in getRoleConfigs();
    },
    ownKeys() {
        return Object.keys(getRoleConfigs());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
        const configs = getRoleConfigs();
        if (prop in configs) {
            return { configurable: true, enumerable: true, value: configs[prop] };
        }
        return undefined;
    },
});

export const VIEWS_SECTION = `## Visões Disponíveis
O usuário pode solicitar uma visão diferente da default (ex: "visão executiva", "detalhes técnicos", "visão de saúde").
Nesse caso, adapte tom e profundidade da resposta, mas suas tools disponíveis NÃO mudam.

Visões:
- *executiva/saúde*: resumo em 3-5 linhas, indicadores OK/Atenção/Crítico, sem jargão
- *técnica*: configs completas, versões, ARNs, correlação entre serviços
- *desenvolvimento*: foco em lambdas, PRs, logs, o que impacta o dia-a-dia do dev
- *debug*: máximo detalhe, logs raw, métricas, timeline de eventos`;
