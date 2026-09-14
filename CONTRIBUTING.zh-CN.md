# 参与贡献喵 AI

感谢你帮助改进喵 AI（Miao）。本仓库是 [PoloX AI](https://github.com/saihhold-zhao/polox_ai) 的中国大模型特化分支。请把 Issue 和 Pull Request 开在 **本仓库**；只有改动确实属于上游时，再开到 PoloX。

[English](CONTRIBUTING.md)

## 开发环境

需要 **Node.js 22.20 或更新版本** 和 **pnpm**。仅长视频拼接需要 FFmpeg 与 ffprobe。

```sh
pnpm i
pnpm dev
```

打开 [http://localhost:3001](http://localhost:3001)。macOS 桌面端：

```sh
pnpm desktop:dev
```

提交 PR 前建议运行：

```sh
pnpm lint
pnpm typecheck
pnpm test:sqlite
pnpm test:electron-main
```

## 目录说明

- `app/` — Nuxt / Vue 界面
- `server/` — Nitro API、Agent 运行时、SQLite、方舟 / DeepSeek / Z.ai 适配
- `shared/` — 两侧共用的模型目录与类型
- `electron/` — macOS 桌面壳
- `i18n/locales/` — 英文与简体中文文案

界面改动请遵循 `.cursor/skills/polox-ui/` 的 gallery-white 工作区规范，并以 `app/assets/css/tailwind.css` 为 token 来源。英文与 `zh-CN` 文案请同步更新。

## Pull Request

1. 保持改动聚焦，不要把重构和功能混在一次提交里。
2. 不要提交 `.data/`、`.env*`、API Key、公证密钥或 `release/` 安装包。
3. 若新增模型服务商，请在 `shared/constants/` 与对应的 `server/ai/` 适配器中注册，并同时更新中英 README。
4. 说明你验证过的路径（Web、桌面端、空状态或失败路径）。

## Issue

请使用 GitHub Issue 模板。粘贴日志前去掉 API Key 和个人项目数据。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要发到公开 Issue。
