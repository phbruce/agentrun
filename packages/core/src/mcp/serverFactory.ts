// SPDX-License-Identifier: AGPL-3.0-only

import type { AwsClients } from "./clientFactory.js";

/**
 * MCP Server factory type.
 * Tool packages register their MCP server factory, which the agent runner calls.
 */
export type McpServerFactory = (awsClients?: AwsClients) => any;

let _factory: McpServerFactory | null = null;

/**
 * Register the MCP server factory.
 * Called by tool packages to provide their MCP server implementation.
 */
export function setMcpServerFactory(factory: McpServerFactory): void {
    _factory = factory;
}

/**
 * Create an MCP server with registered tools.
 */
export function createMcpServer(awsClients?: AwsClients): any {
    if (!_factory) {
        throw new Error("No MCP server factory registered. Call setMcpServerFactory() first.");
    }
    return _factory(awsClients);
}
