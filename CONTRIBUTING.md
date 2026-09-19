# Contributing to Miao AI

Thank you for helping improve Miao. Please open issues and pull requests in this repository.

[简体中文](CONTRIBUTING.zh-CN.md)

## Development setup

You need **Node.js 22.20 or newer** and **pnpm**. FFmpeg and ffprobe are required only for long-form video concatenation.

```sh
pnpm i
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001). For the macOS desktop shell:

```sh
pnpm desktop:dev
```

Useful checks before you open a pull request:

```sh
pnpm lint
pnpm typecheck
pnpm test:llm
pnpm test:sqlite
pnpm test:electron-main
```

## Project map

- `app/` — Nuxt / Vue UI
- `server/` — Nitro APIs, agent runtime, SQLite, Ark / DeepSeek / Z.ai / Agnes adapters
- `shared/` — model catalogs and types used by both sides
- `electron/` — macOS desktop shell
- `i18n/locales/` — English and Simplified Chinese strings

UI work should follow the gallery-white creative workspace in `.cursor/skills/polox-ui/` (and `app/assets/css/tailwind.css` as the token source). Keep English and `zh-CN` strings in sync.

## Pull requests

1. Keep the change focused. Do not mix refactors with feature work.
2. Do not commit `.data/`, `.env*`, API keys, notarization secrets, or `release/` artifacts.
3. If you add a model provider, register it in `shared/constants/` and the corresponding `server/ai/` adapter, then document it in both READMEs.
4. Describe what you verified (web, desktop, empty state, or a failing path).

## Issues

Use the GitHub issue templates. Remove API keys and personal project data from logs before pasting.

Security reports belong in [SECURITY.md](SECURITY.md), not in public issues.
