// SPDX-License-Identifier: AGPL-3.0-only

import type { Executor } from "./types.js";

/**
 * Registry of executors keyed by `type`. The Platform exposes registration
 * (`platform.registerExecutor(...)`) and the orchestrator uses `get()` to
 * dispatch a tool call to the right executor.
 *
 * Duplicate registrations are rejected to prevent accidental overrides.
 */
export class ExecutorRegistry {
    private readonly executors = new Map<string, Executor>();

    register(executor: Executor): void {
        if (this.executors.has(executor.type)) {
            throw new Error(`Executor already registered for type: ${executor.type}`);
        }
        this.executors.set(executor.type, executor);
    }

    get(type: string): Executor {
        const executor = this.executors.get(type);
        if (!executor) {
            throw new Error(`No executor registered for type: ${type}`);
        }
        return executor;
    }

    has(type: string): boolean {
        return this.executors.has(type);
    }

    list(): readonly string[] {
        return Array.from(this.executors.keys());
    }
}
