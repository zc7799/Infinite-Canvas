# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infinite-Canvas 是一个 AI 图像/视频/LLM 生成平台，通过统一的前端界面调用多种 AI 后端（ComfyUI、ModelScope、OpenAI 协议 API、RunningHub、火山引擎）。采用 Python FastAPI 后端 + 原生 JS/HTML 前端，单个 `main.py` 包含全部路由和业务逻辑，使用文件系统 JSON 存储数据。

## 启动与开发

```bash
# Windows（使用项目自带的 python/ 目录）
run.bat

# Mac
./mac-启动服务.command

# 手动启动
python main.py

# 安装依赖（Windows，离线优先）
安装依赖.bat

# 安装依赖（Mac，离线优先）
./mac-安装依赖.sh

# 手动安装依赖
pip install -r requirements.txt
```

服务默认运行在 `http://127.0.0.1:3000/`。

## 架构

### 后端 (main.py, ~7000 行)

单文件 FastAPI 应用，核心模块：

- **WebSocket 管理**（`ConnectionManager` 类，~L68-166）：实时推送在线人数统计、新图片生成通知、画布更新广播。连接路径 `/ws/stats`。
- **AI 生成路由**：
  - `POST /generate` — ModelScope Z-Image 异步生成（CloudGenRequest）
  - `POST /api/generate` — ComfyUI 本地/远程工作流执行
  - `POST /api/online-image` — 通用 API 提供商在线生图（支持多 provider 协议）
  - `POST /api/canvas-video` — 视频生成
  - `POST /api/canvas-llm` — 画布 LLM 调用
  - `POST /api/ms/generate` — ModelScope 模型生成
- **对话系统**：`POST /api/chat` 和 `/api/chat/stream`（SSE），支持 GPT 对话模式和图片生成模式，多轮对话历史以 JSON 文件存储在 `data/conversations/`。
- **画布系统**：`/api/canvases` CRUD，节点式编辑器数据存储在 `data/canvases/*.json`，支持软删除（30 天回收站）。
- **工作流管理**：`/api/workflows` — 内置工作流（`workflows/*.json`）和自定义工作流（`workflows/custom/`），每个工作流可关联 `.config.json` 配置参数。
- **RunningHub 集成**：`/api/runninghub/*` — 工作流提交、查询、资产管理。
- **API Provider 管理**：`/api/providers` — 多后端配置管理（支持 openai/apimart/gemini/volcengine/runninghub 协议），配置存储在 `data/api_providers.json`。
- **自动更新**：`/api/update-from-github` 和 `/api/update-rollback` — 从 GitHub 拉取 `main.py`/`static/`/`VERSION` 并热更新，支持回滚。

### 前端 (static/)

每个 HTML 文件是独立的单页应用，对应 JS 和 CSS 文件同名：

| 文件 | 功能 |
|------|------|
| `index.html` + `canvas.js` | 主界面：聊天 + 图片生成 Tab + 画布 |
| `canvas.html` | 无限画布（节点式创作工具） |
| `smart-canvas.html` + `smart-canvas.js` | 智能画布（增强版节点编辑） |
| `online.html` | 在线图片生成 |
| `enhance.html` | 图片增强（Z-Image-Enhance） |
| `zimage.html` | Z-Image 模型生成 |
| `klein.html` | Flux2-Klein 模型 |
| `angle.html` | LTX Director 视频时间线编辑 |
| `gpt-chat.html` | GPT 独立聊天页面 |
| `api-settings.html` + `api-settings.js` | API 提供商配置面板 |
| `comfyui-settings.html` + `comfyui-settings.js` | ComfyUI 实例和工作流设置 |

共享模块：
- `static/js/i18n-core.js` — 轻量 i18n 引擎（zh/en，`window.StudioI18n`），使用 `data-i18n` 属性自动翻译
- `static/js/i18n/` — 各模块的语言包（common/studio/api-settings/canvas/smart-canvas/comfyui-settings），`validate-i18n.js` 用于检查翻译完整性
- `static/js/theme.js` — 主题切换
- `static/vendor/` — 第三方库

### 数据流

```
API 请求 → FastAPI 路由 → 调用上游 AI 服务（httpx）→ 返回结果 URL
                                          ↓
                              同时写入 history.json（全局历史）
                              同时通过 WebSocket 广播通知所有在线客户端
                              图片下载到 assets/output/
```

### 配置体系

- `API/.env` — API Key 和环境变量（启动时加载到 `os.environ`）
- `data/api_providers.json` — UI 可管理的 API 提供商列表
- `VERSION` — 版本号文件（用于自动更新检测）
- `global_config.json` — 全局配置（主题、语言等）
- `data/asset_library.json` — 素材库

### 关键全局变量 (main.py)

- `COMFYUI_INSTANCES` — ComfyUI 后端地址列表（从 `.env` 读取，默认 `127.0.0.1:8188`）
- `MODELSCOPE_API_KEY` — ModelScope API 密钥
- `AI_BASE_URL` / `AI_API_KEY` — 通用 AI 后端（默认 `https://ai.comfly.chat`）
- `BACKEND_LOCAL_LOAD` — 多 ComfyUI 实例负载计数

### 离线包

`packages/` 目录包含所有 Python 依赖的 `.whl` 文件，`安装依赖.bat` 和 `mac-安装依赖.sh` 优先离线安装。

### 注意事项

- 前端 JS 文件通过 `<script>` 标签直接加载，没有模块打包器（无 webpack/vite）
- 所有数据以 JSON 文件持久化，无数据库
- `main.py` 启动时会自动同步 `static/*.html` 中的版本查询参数（`?v=...`）用于缓存破坏
- Canvas assets 的二进制文件（图片等）存储在 `assets/library/` 和画布 JSON 的 base64 内嵌中
- `.gitignore` 排除了 `data/`、`api/`、`assets/`、`history.json`、`workflows/custom/`，这些是运行时产生的用户数据
