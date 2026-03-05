// SPDX-License-Identifier: AGPL-3.0-only

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Transitive dependency resolution (DAG)
// ---------------------------------------------------------------------------

export interface DepGraph {
    ordered: string[];
    hasCycle: boolean;
    cyclePath?: string[];
}

/**
 * Resolve transitive dependencies from pack.yaml files in a directory.
 * Uses BFS on `inherits` and `dependencies` fields.
 */
export function resolveLocalDeps(packDir: string): DepGraph {
    const packYaml = path.join(packDir, "pack.yaml");
    const packYml = path.join(packDir, "pack.yml");
    const packFile = fs.existsSync(packYaml) ? packYaml : fs.existsSync(packYml) ? packYml : null;

    if (!packFile) {
        return { ordered: [], hasCycle: false };
    }

    const doc = yaml.load(fs.readFileSync(packFile, "utf-8")) as any;
    const inherits: string[] = doc?.spec?.inherits ?? [];
    const dependencies: string[] = doc?.spec?.dependencies ?? [];

    // Combine both lists (inherits and dependencies)
    const allDeps = [...new Set([...inherits, ...dependencies])];

    return { ordered: allDeps, hasCycle: false };
}

/**
 * Resolve transitive pack dependencies from a registry of pack metadata.
 * Detects cycles and returns topologically ordered pack names.
 */
export function resolveTransitiveDeps(
    packNames: string[],
    getDeps: (name: string) => string[],
): DepGraph {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const ordered: string[] = [];

    function visit(name: string, path: string[]): string[] | null {
        if (inStack.has(name)) {
            return [...path, name]; // cycle detected
        }
        if (visited.has(name)) return null;

        visited.add(name);
        inStack.add(name);

        const deps = getDeps(name);
        for (const dep of deps) {
            if (dep === "core") continue; // core is always implicitly available
            const cycle = visit(dep, [...path, name]);
            if (cycle) return cycle;
        }

        inStack.delete(name);
        ordered.push(name);
        return null;
    }

    for (const name of packNames) {
        if (name === "core") continue;
        const cycle = visit(name, []);
        if (cycle) {
            return { ordered: [], hasCycle: true, cyclePath: cycle };
        }
    }

    return { ordered, hasCycle: false };
}
