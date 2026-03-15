// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-ai/channel-gchat — Google Chat channel adapter for AgentRun

// Adapter
export { GChatChannelAdapter } from "./adapter.js";

// Google Chat API client
export { postMessage, createCardMessage, updateMessage, deleteMessage } from "./gchatClient.js";
export type { GChatCard, GChatSection, GChatWidget, GChatButton } from "./gchatClient.js";

// Formatting helpers
export { formatAgentResponse, formatErrorResponse, formatGreetingCard, markdownToHtml } from "./formatting.js";
