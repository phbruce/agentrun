// SPDX-License-Identifier: AGPL-3.0-only
export type { SecretProvider, SecretDeclaration, ResolvedSecrets } from "./types.js";
export { SsmSecretProvider } from "./ssmProvider.js";
export { SecretResolver } from "./resolver.js";

import { SecretResolver } from "./resolver.js";
import { SsmSecretProvider } from "./ssmProvider.js";

export function createSecretResolver(): SecretResolver {
    const resolver = new SecretResolver();
    resolver.registerProvider(new SsmSecretProvider());
    return resolver;
}
