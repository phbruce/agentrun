# Channel-Slack Feature Parity Audit

This document inventories what `@agentrun-ai/channel-slack` ships today
and what is typically built on top of it for production deployments.
The audit lives in-repo so contributors can see at a glance what is in
scope of the package vs. what they need to wire themselves.

## What ships today

| File | Purpose |
|------|---------|
| `adapter.ts` | `SlackChannelAdapter` implementing `ChannelAdapter` from core; reactions, thread/response_url delivery |
| `blockKit.ts` | Block Kit assembly for agent responses (success/error) |
| `formatting.ts` | Greeting + per-category response shaping |
| `mrkdwnConverter.ts` | Markdown → Slack mrkdwn converter |
| `richTextSerializer.ts` | Markdown → Slack rich-text blocks |
| `slackClient.ts` | Thin fetch-based wrappers: `postToResponseUrl`, `postMessage`, `postThreadMessage`, `addReaction`, `getUserProfileImage` |
| `templateRenderer.ts` | Greeting / response / error templates |
| `events.ts` | Typed Slack event envelopes + `isUrlVerification` / `isEventCallback` guards |
| `slashCommand.ts` | `SlashCommandRouter` + `parseSlashCommandBody` |

The package has **zero runtime dependencies** beyond `@agentrun-ai/core`.
Slack API auth tokens are read from `process.env.SLACK_BOT_TOKEN` inside
`slackClient.ts`; the package itself does not own credentials.

## What is missing for a full Slack channel

| Capability | Status | Notes |
|-----------|--------|-------|
| Webhook event verification | Missing | Slack signs `X-Slack-Signature` over `v0:{ts}:{body}` with the signing secret; the verifier needs to be re-implemented per consumer today |
| Socket Mode bootstrap | Missing | The `@slack/socket-mode` WebSocket lifecycle (connect, reconnect, ack, slash_commands, message) is re-implemented per consumer |
| Interactive payloads | Missing | `block_actions`, `view_submission`, `view_closed` are not modeled; consumers parse them themselves |
| OAuth `/connect` modal | Missing | Modal trigger + view → `views.open` → handler is a common pattern not abstracted here |
| Delivery to ephemeral or DM | Partial | `slackClient.postMessage` exists but the adapter only uses `postThreadMessage` / `postToResponseUrl` |

## Future work

- Add an optional `peerDependencies` block targeting `@slack/web-api`
  and `@slack/socket-mode`; ship a `createSocketModeBootstrap` helper
  that lazily imports them. Lazy import keeps the channel zero-cost
  for the HTTP-only deployments under `examples/aws-lambda`.
- Add signature verification utility (`verifyRequestSignature`) once
  the package decides whether to depend on `node:crypto` or stay pure-JS.
- Modal helpers for `/connect` (`buildConnectModal`, `parseConnectSubmission`).
