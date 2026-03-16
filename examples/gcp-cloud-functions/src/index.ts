// SPDX-License-Identifier: AGPL-3.0-only
// Cloud Functions entry points — re-export all handlers.

import "./setup.js";

export { eventsHandler } from "./handlers/events.js";
export { gchatEventsHandler } from "./handlers/gchat-events.js";
export { processHandler } from "./handlers/process.js";
export { mcpHandler } from "./handlers/mcp-server.js";
