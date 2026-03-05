// SPDX-License-Identifier: AGPL-3.0-only
import { ForbiddenError } from "../errors.js";
import { Action, getPermissionsForRole, getRoleForUser } from "./permissions.js";

export function checkPermission(userId: string, action: Action): void {
    const role = getRoleForUser(userId);
    const allowed = getPermissionsForRole(role);
    if (!allowed.includes(action)) {
        throw new ForbiddenError(`User ${userId} does not have permission for ${action}`);
    }
}
