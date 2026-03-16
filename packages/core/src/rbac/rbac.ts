// SPDX-License-Identifier: AGPL-3.0-only
import { ForbiddenError } from "../errors.js";
import { Action, getPermissionsForRole, getRoleForUser } from "./permissions.js";
import type { IdentitySource } from "./types.js";

export function checkPermission(userId: string, source: IdentitySource, action: Action): void {
    const role = getRoleForUser(userId, source);
    const allowed = getPermissionsForRole(role);
    if (!allowed.includes(action)) {
        throw new ForbiddenError(`User ${userId} does not have permission for ${action}`);
    }
}
