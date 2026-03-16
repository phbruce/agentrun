// SPDX-License-Identifier: AGPL-3.0-only

import pino from "pino";

export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
});
