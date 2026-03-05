# Contributing to AgentRun

Thank you for your interest in contributing to AgentRun. This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 18
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Git

### Getting started

```bash
git clone https://github.com/phbruce/agentrun.git
cd agentrun
pnpm install      # installs deps + sets up husky hooks automatically
pnpm run build    # builds all 8 packages via Turbo
pnpm run typecheck # type-checks all packages
```

### Project structure

```
agentrun/
├── packages/
│   ├── core/           # @agentrun-oss/core — orchestrator, RBAC, catalog, RAG
│   ├── aws/            # @agentrun-oss/aws — Bedrock, DynamoDB, S3, SQS providers
│   ├── channel-slack/  # @agentrun-oss/channel-slack — Slack adapter
│   ├── channel-mcp/    # @agentrun-oss/channel-mcp — MCP JSON-RPC server
│   ├── tools-aws/      # @agentrun-oss/tools-aws — AWS infrastructure tools
│   ├── tools-github/   # @agentrun-oss/tools-github — GitHub tools
│   ├── tools-jira/     # @agentrun-oss/tools-jira — Jira tools
│   └── cli/            # @agentrun-oss/cli — CLI (validate, sync, ingest)
├── examples/           # Deployment examples (Lambda, GCP, Docker, standalone)
└── docs/               # Documentation
```

### Working on a specific package

```bash
# Type-check a single package
pnpm --filter @agentrun-oss/core typecheck

# Build a single package
pnpm --filter @agentrun-oss/core build

# Build a package and all its dependencies
pnpm --filter @agentrun-oss/channel-slack... build
```

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky.

### Format

```
type(scope): subject

[optional body]

[optional footer]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code restructuring, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD configuration |
| `chore` | Maintenance tasks |
| `revert` | Reverting a previous commit |

### Scopes

Use the package name without the `@agentrun-oss/` prefix:

`core`, `aws`, `channel-slack`, `channel-mcp`, `tools-aws`, `tools-github`, `tools-jira`, `cli`, `deps`, `release`

### Examples

```
feat(core): add session expiration based on TTL
fix(tools-jira): migrate search to POST /search/jql
docs(cli): add ingest command usage examples
build(deps): upgrade @aws-sdk to 3.750
```

### Blocked trailers

The following git trailers are **not allowed** and will be rejected by the commit-msg hook:

- `Co-Authored-By` — all commits must be attributed to their human author
- `Signed-off-by` — not used in this project

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes in small, focused commits following the conventions above
3. Ensure `pnpm run typecheck` passes (runs automatically as pre-commit hook)
4. Open a PR against `main` with a clear title and description
5. Fill out the PR template

### PR titles

Use the same Conventional Commits format for PR titles. The PR will be squash-merged, and the PR title becomes the commit message.

## Adding a New Tool

Tools are defined as TypeScript handlers + YAML manifests:

1. Create the handler in the appropriate `tools-*` package
2. Export it from the package's `index.ts`
3. Create a YAML manifest describing the tool's metadata
4. Register the tool factory in your `setup.ts`

See existing tools in `packages/tools-aws/src/` for reference.

## Adding a New Channel

1. Create a new `channel-*` package under `packages/`
2. Implement the `ChannelAdapter` interface from `@agentrun-oss/core`
3. Add the package to `pnpm-workspace.yaml`
4. Update `commitlint.config.mjs` to include the new scope

## Reporting Issues

- **Bugs**: Use the [bug report template](.github/ISSUE_TEMPLATE/bug.md)
- **Features**: Use the [feature request template](.github/ISSUE_TEMPLATE/feature.md)
- **Security**: See [SECURITY.md](SECURITY.md) — do **not** open a public issue

## Contributor License Agreement

By submitting a pull request, you agree to the terms of our [CLA](CLA.md). This grants the project maintainers the right to use your contribution under the AGPLv3 license and potentially under a commercial license in the future.

## License

All contributions are licensed under [AGPLv3](LICENSE). Every source file should include the SPDX header:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
```
