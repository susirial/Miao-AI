<p align="center">
  <img src="docs/images/logo.png" width="88" alt="喵 AI 标志">
</p>

<h1 align="center">喵 AI</h1>

<p align="center">
  <strong>M</strong> 大模型 · <strong>I</strong> 智能 · <strong>A</strong> 创作助手 · <strong>O</strong> 开放<br>
  面向中国大模型的开放创作助手。用对话调用文本、图像与视频，结果落在无限画布上。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-d2e24a?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/susirial/Miao-AI/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/susirial/Miao-AI/ci.yml?style=flat-square" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.20-339933?style=flat-square" alt="Node.js 22.20+">
  <img src="https://img.shields.io/badge/desktop-macOS-47848F?style=flat-square&logo=electron" alt="macOS desktop">
  <a href="https://github.com/susirial/Miao-AI/stargazers"><img src="https://img.shields.io/github/stars/susirial/Miao-AI?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="docs/images/hero-desktop.png" alt="喵 AI：Agent 对话与无限画布">
</p>

**喵 AI**（Miao）是本地优先的创作助手：你和 Agent 对话，每一张图、每一段视频都落在无限画布上。本项目由 [PoloX AI](https://github.com/saihhold-zhao/polox_ai) 魔改而来。

使用你自己的密钥。无需注册喵 AI 账号或云端工作区。项目、对话、生成记录和媒体都保存在本机。

## MIAO 四个字母

| | 含义 | 在产品里 |
| --- | --- | --- |
| **M** | 大模型 | 文本、生图、视频等模型：GLM、DeepSeek、豆包、Seedream、Seedance，并持续接入 |
| **I** | 智能 | Agent 会规划、确认关键选择，并执行多步制作 |
| **A** | 创作助手 | 对话 + 无限画布，而不是一个提示词输入框 |
| **O** | 开放 | MIT 开源、本地运行、自带 Key |

## 为什么用喵 AI

- **大模型在同一条对话里。** 用 `@` 指定 GLM 5.3、DeepSeek、豆包 Seed、Seedream 5 或 Seedance 2，不必跳出工作流。
- **智能会把事情做完。** Agent 把一句话变成分镜、静帧或视频，并继续和你一起改。
- **创作助手，不是聊天窗口。** 每个结果留在画布上，方便比较、复用和导出。
- **开放，且在你的机器上。** Web 与 macOS 桌面；数据在本地 SQLite；没有喵 AI 云。

## 截图

<p align="center">
  <img src="docs/images/landing.png" alt="喵 AI 落地页">
</p>
<p align="center">
  <img src="docs/images/projects.png" alt="喵 AI 项目工作区">
</p>
<p align="center">
  <img src="docs/images/models.png" alt="Seedream 与 Seedance 模型卡片">
</p>
<p align="center">
  <img src="docs/images/connect.png" alt="服务连接弹窗">
</p>

## 已接入模型

在 Agent 输入框输入 `@` 可指定模型。图像与视频生成走 [火山方舟](https://console.volcengine.com/ark)。目录见 `shared/constants/modelCatalog.ts` 与 `shared/constants/aiModels.ts`。

| 用途 | 模型 | 服务商 |
| --- | --- | --- |
| Agent 文本（默认） | Seed 2.1 Pro | 火山方舟 · 豆包 |
| Agent 文本 | Seed 2.1 Turbo | 火山方舟 · 豆包 |
| Agent 文本 | DeepSeek V4.1 Flash | DeepSeek 官方 |
| Agent 文本 | GLM 5.3 | Z.ai 官方 |
| 图像 · t2i / i2i / r2i | Seedream 5.0 Pro | 火山方舟 |
| 视频 · t2v / i2v / r2v | Seedance 2.0 | 火山方舟 |

模型仍在持续添加。若需要某个国内端点，请开 [Issue](https://github.com/susirial/Miao-AI/issues)。

## 快速开始

需要 **Node.js 22.20+** 和 **pnpm**。

```sh
git clone https://github.com/susirial/Miao-AI.git
cd Miao-AI
pnpm i
pnpm dev
```

打开 [http://localhost:3001](http://localhost:3001)，保持终端运行。日常使用不必执行 `pnpm build`。

### macOS 桌面端

```sh
pnpm desktop:dev          # Nuxt 热更新 + Electron 窗口
pnpm desktop:dir          # 未打包的 Miao.app，用于本机验证
pnpm desktop:build        # 在 release/ 下生成 DMG 和 ZIP
```

桌面数据位于 `~/Library/Application Support/Miao/data`，日志位于 `~/Library/Logs/Miao`。未签名构建可以在本机使用；分发到其他 Mac 需要 Developer ID 证书。同时设置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后会自动公证。

Linux 与 Windows 目前可运行 **Web**。安装包仅提供 macOS。

### FFmpeg（仅长视频拼接）

普通上传和单次生成不需要 FFmpeg。把多个片段拼成更长视频时需要。

```sh
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt update && sudo apt install ffmpeg
```

确认 `ffmpeg` 与 `ffprobe` 都在 `PATH` 中，然后重启应用。

## 配置服务商

1. 启动喵 AI，点击右上角 **服务连接**。
2. 填写 [火山方舟 API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)。方舟提供 Seed 文本、Seedream 图像和 Seedance 视频。
3. 可选填写 [DeepSeek](https://platform.deepseek.com/api_keys) 或 [Z.ai](https://z.ai/manage-apikey/apikey-list) 密钥，并选择对应文本模型。
4. 点击 **保存并测试已配置服务**。

默认 Agent 模型为 **Seed 2.1 Pro**（`ark/seed-2.1-pro`）。连通测试会发送一次短请求，可能产生少量费用。密钥存在本地 SQLite，不要写进 `.env`。

### 可选 TOS：Seedance 本地参考素材

文生视频和图生视频不需要 TOS。仅当把本机视频/音频作为 Seedance 参考时，才需要 `cn-beijing` 的 Bucket。Region 与 endpoint 固定为 `https://tos-cn-beijing.volces.com`。喵 AI 按内容哈希上传对象并签发短期 GET URL；删除任务时不会删除 TOS 对象。

## 架构

```mermaid
flowchart LR
  ui[Nuxt Vue 界面]
  nitro[Nitro 服务]
  sqlite[(SQLite 与媒体)]
  electron[Electron utility process]
  ark[火山方舟]
  ds[DeepSeek]
  zai[Z.ai]

  ui --> nitro
  electron --> nitro
  nitro --> sqlite
  nitro --> ark
  nitro --> ds
  nitro --> zai
```

- `app/` — Vue 页面、画布、Agent 对话
- `server/` — API、进程内 Agent 循环、方舟 / DeepSeek / Z.ai 适配
- `shared/` — 模型目录与类型
- `electron/` — macOS 壳：隔离 Nitro、随机回环端口、每次启动独立令牌，渲染进程无 Node

没有在线 Demo。工作区接口默认不鉴权 —— 请只在本机或私有网络运行 Web 服务。

## 创作流程

可以让 Agent 编辑图片或视频，或制作多分镜成片。长视频的典型路径：

1. 根据需求规划分镜。
2. 确定角色参考（也可上传自己的形象）。
3. 为每个镜头生成首帧。
4. 用 Seedance 把镜头做成片段。
5. 用 FFmpeg 拼接，并在同一对话里继续修改。

Skill 文件见 [`server/agent/skills/long-form-video.md`](server/agent/skills/long-form-video.md)。

## 本地数据

| 启动方式 | 数据库与媒体 |
| --- | --- |
| Web | `.data/miao.sqlite` 与 `.data/media` |
| 桌面 | `~/Library/Application Support/Miao/data` |
| 覆盖 | `MIAO_DATA_DIR` |

升级后首次启动会复制已有的 `.data/polox.sqlite`。请先停止服务再备份 `.data`。备份里含 API Key，请当作机密保管。

可选进程环境变量见 [`.env.example`](.env.example)。不要把服务商密钥写进去。

## 参与贡献

见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) / [English](CONTRIBUTING.md)。涉及密钥或本地数据的问题请先读 [SECURITY.md](SECURITY.md)。

```sh
pnpm lint
pnpm typecheck
pnpm test:sqlite
pnpm test:electron-main
```

## 使用到的开源项目

| 用途 | 项目 |
| --- | --- |
| 应用框架 | [Nuxt](https://github.com/nuxt/nuxt) |
| UI | [shadcn/ui](https://github.com/shadcn-ui/ui) Vue 生态 |
| UI 模板 | [nuxt-shadcn-dashboard](https://github.com/dianprata/nuxt-shadcn-dashboard) |
| Agent Harness | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) |

## 开源协议

[MIT](LICENSE)。第三方声明见 [NOTICE](NOTICE)。
