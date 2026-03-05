// SPDX-License-Identifier: AGPL-3.0-only

// @agentrun-oss/channel-slack — Slack channel adapter for AgentRun

// Adapter
export { SlackChannelAdapter } from "./adapter.js";

// Slack API client
export {
    postToResponseUrl,
    postMessage,
    postThreadMessage,
    getUserProfileImage,
    addReaction,
} from "./slackClient.js";
export type { SlackPostPayload } from "./slackClient.js";

// Block Kit formatting
export { formatAgentResponse, formatErrorResponse } from "./blockKit.js";

// Formatting helpers
export {
    formatGreeting,
    formatCategoryResponse,
    formatErrorBlocks,
    parseIntoBlocks,
} from "./formatting.js";

// Markdown converters
export { markdownToMrkdwn } from "./mrkdwnConverter.js";
export { markdownToRichTextBlocks } from "./richTextSerializer.js";

// Template renderer
export { renderGreeting, renderResponse, renderError } from "./templateRenderer.js";
export type { RenderContext } from "./templateRenderer.js";
