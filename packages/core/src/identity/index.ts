// SPDX-License-Identifier: AGPL-3.0-only
import type { IdentityProvider } from "./types.js";
import { StaticIdentityProvider } from "./staticProvider.js";

// Swap this line when migrating to Google/SSO
let provider: IdentityProvider = new StaticIdentityProvider();

export function getIdentityProvider(): IdentityProvider {
    return provider;
}

export function setIdentityProvider(p: IdentityProvider) {
    provider = p;
}

export type { IdentityProvider, ResolvedIdentity } from "./types.js";
