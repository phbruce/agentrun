# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities by [opening a private security advisory on GitHub](https://github.com/phbruce/agentrun/security/advisories/new).

Include:

- Description of the vulnerability
- Steps to reproduce
- Affected package(s) and version(s)
- Potential impact

## Response Timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix or mitigation**: depends on severity, typically within 30 days

## Disclosure Policy

We follow coordinated disclosure. We will:

1. Confirm the vulnerability and determine affected versions
2. Develop and test a fix
3. Release a patched version
4. Publish a security advisory on GitHub

We ask that you do not publicly disclose the vulnerability until a fix has been released.

## Scope

This policy applies to all packages under the `@agentrun-ai` npm scope:

- `@agentrun-ai/core`
- `@agentrun-ai/aws`
- `@agentrun-ai/channel-slack`
- `@agentrun-ai/channel-mcp`
- `@agentrun-ai/tools-aws`
- `@agentrun-ai/tools-github`
- `@agentrun-ai/tools-jira`
- `@agentrun-ai/cli`
