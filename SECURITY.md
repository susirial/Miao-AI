# Security Policy

## Supported versions

Security fixes are accepted against the default `main` branch of [Miao-AI](https://github.com/susirial/Miao-AI).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Use [GitHub Private Vulnerability Reporting](https://github.com/susirial/Miao-AI/security/advisories/new) so we can coordinate a fix before it is disclosed.

Include:

- A description of the issue and its impact
- Steps to reproduce, or a minimal proof of concept
- Affected version or commit, OS, and whether you used web (`pnpm dev`) or the desktop app

We will acknowledge the report when we see it and follow up with a fix or a reasoned decline.

## What this project stores locally

Miao is designed for **local use**. Provider API keys, TOS credentials, projects, conversations, and media live in SQLite and files on the machine that runs the app:

- Web: `.data/` in the project directory (override with `MIAO_DATA_DIR`)
- macOS desktop: `~/Library/Application Support/Miao/data`

The standalone web server does not authenticate workspace routes. Do not expose it to the public internet. The Electron build binds to a random `127.0.0.1` port and requires a per-launch desktop token.

Never paste API keys, TOS secrets, or database dumps into issues, pull requests, or chat.

## Model providers

Prompts, uploaded media, and generation parameters are sent to the providers you configure (Volcengine Ark, DeepSeek, Z.ai, and optional TOS). Their security and privacy terms apply to that traffic. Miao does not operate a cloud inference service of its own.
