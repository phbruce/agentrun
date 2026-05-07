# Executor Pattern Demo

Minimal walk-through of the protocol-agnostic Executor Registry — no
Slack, no LLM, no infrastructure. Just the dispatch path that the rest
of agentrun is built around.

## Run

```bash
# From the repo root:
pnpm install
pnpm --filter agentrun-example-executor-pattern-demo dev
```

Expected output:

```
Tool dispatched via executor: cli
Result: { type: 'text', text: '{ "stdout": "hello\\n", "stderr": "", "code": 0 }' }
```

## What it demonstrates

Tools declare a `type`, executors implement a `type`, the orchestrator
dispatches by lookup. No `if (tool.type === "http")` chains in the
orchestrator; new transports are added by registration, not by
patching the dispatch path.

```ts
import { createPlatform, type Executor } from "@agentrun-ai/core";

// 1. Build a Platform.
const platform = createPlatform(config);

// 2. Register an executor — the `type` is its identity.
const cliExecutor: Executor = {
    type: "cli",
    async execute(tool, args, ctx) { /* run a shell command */ },
};
platform.registerExecutor(cliExecutor);

// 3. Define a tool whose `type` matches.
const echoTool = { name: "echo", type: "cli", command: "echo hello", ... };

// 4. Resolve and execute.
const executor = platform.executors.get(echoTool.type);
const result = await executor.execute(echoTool, {}, ctx);
```

## Where to go next

Real-world executors live in their own packages so you don't reinvent
the dispatch machinery:

- `@agentrun-ai/executor-http` — REST/JSON tools
- `@agentrun-ai/executor-cli` — shell-out / local CLI tools
- `@agentrun-ai/executor-gcp-sdk` — Google Cloud SDK calls (BigQuery, Discovery Engine, ...)
- `@agentrun-ai/executor-mcp-client` — proxy to other MCP servers

Each one exports an `Executor` instance you can register on the
Platform. For a complete server using these executors plus a Slack
channel, see `examples/slack-standalone/` or the Docker example in
`examples/docker/`.
