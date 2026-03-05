// SPDX-License-Identifier: AGPL-3.0-only

import type { ToolDef, ManifestCatalog } from "../catalog/types.js";
import type { ResolvedSecrets } from "../secret/types.js";
import type { ToolHandler } from "./registry.js";

/**
 * Hydrate a declarative tool definition into a callable handler.
 * Declarative tools are defined in YAML manifests and executed at runtime
 * via AWS SDK, HTTP, or Lambda invocation.
 */
export function hydrateDeclarativeTool(
    _tool: ToolDef,
    _secrets: Map<string, ResolvedSecrets>,
): ToolHandler | null {
    // Stub — will be implemented by tool packages
    return null;
}

/**
 * Hydrate workflow steps into callable MCP tools.
 * Workflows with steps are converted into standalone tools.
 */
export function hydrateWorkflowAsTools(
    _catalog: ManifestCatalog,
    _secrets: Map<string, ResolvedSecrets>,
): Map<string, ToolHandler> {
    // Stub — will be implemented by tool packages
    return new Map();
}
