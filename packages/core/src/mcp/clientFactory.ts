// SPDX-License-Identifier: AGPL-3.0-only

import type { ResolvedIdentity } from "../identity/types.js";

/**
 * Scoped clients for tool execution.
 * Implementations provide cloud-specific clients (e.g., AWS SDK clients).
 */
export interface AwsClients {
    [key: string]: unknown;
}

export type ClientFactory = (identity: ResolvedIdentity) => Promise<AwsClients>;

let _factory: ClientFactory | null = null;

/**
 * Register a client factory for creating scoped clients per identity.
 */
export function setClientFactory(factory: ClientFactory): void {
    _factory = factory;
}

/**
 * Create scoped clients for a resolved identity.
 */
export async function createClientsForIdentity(identity: ResolvedIdentity): Promise<AwsClients | undefined> {
    if (!_factory) return undefined;
    return _factory(identity);
}
