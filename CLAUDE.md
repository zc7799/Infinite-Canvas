# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infinite-Canvas 是一个 AI 图像/视频/LLM 生成平台，通过统一的前端界面调用多种 AI 后端（ComfyUI、ModelScope、OpenAI 协议 API、RunningHub、火山引擎）。采用 Python FastAPI 后端 + 原生 JS/HTML 前端（含 Vue 3 + TypeScript 渐进迁移），使用文件系统 JSON 存储数据。

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

### 后端：三层架构（Route → Service → Provider）

`main.py`（164 行）仅作为应用入口，包含：FastAPI 实例化、CORS 中间件、WebSocket 端点、16 个路由注册、共享全局状态（QUEUE/CANVAS_TASKS 等）、验证错误处理器、静态文件挂载。

```
main.py (入口, 164 行)
├── server/config.py            — 路径常量 + 环境变量 + 配置加载
├── server/exceptions.py        — AppError / ProviderError / MediaError
├── server/models/              — Pydantic 请求/响应模型
│   ├── __init__.py             — 统一导出
│   ├── generation.py           — OnlineImageRequest, CanvasVideoRequest, GenerateRequest 等
│   ├── chat.py                 — ChatRequest, ConversationCreateRequest
│   ├── canvas.py               — CanvasCreateRequest, CanvasLLMRequest 等
│   ├── workflow.py             — WorkflowField, WorkflowConfig, WorkflowRunRequest
│   └── provider.py             — ApiProviderPayload, RunningHubSubmitRequest 等
├── server/data/                — JSON 文件存储（原子写入 + 自动备份）
│   ├── base_store.py           — JsonStore 基类
│   ├── history_store.py        — HistoryStore（归档 + 分页）
│   ├── conversation_store.py   — 对话 CRUD
│   ├── canvas_store.py         — 画布 CRUD + 软删除
│   ├── asset_library_store.py  — 素材库管理
│   └── workflow_store.py       — 工作流文件校验 + 配置路径
├── server/providers/           — AI Provider 适配器（纯函数 + ABC 基类）
│   ├── base.py                 — BaseProvider ABC + @register_provider 注册表
│   ├── apimart.py              — APIMart 视频/图片上传 + 参数规范化
│   ├── volcengine.py           — 火山引擎 Seedance/Seedream 工具函数
│   ├── modelscope.py           — ModelScope 尺寸 + 图片 URL 工具
│   └── gemini.py               — Gemini 图片生成配置
├── server/services/            — 业务逻辑（纯函数，不依赖 FastAPI）
│   ├── media_service.py        — 输出存储、媒体引用转换、图片压缩
│   ├── image_service.py        — AI 生图核心流程
│   ├── chat_service.py         — 对话解析、SSE 流处理、Provider 路由
│   ├── comfyui_service.py      — ComfyUI 负载均衡、输出下载、历史记录
│   ├── video_service.py        — 视频任务轮询、上传
│   ├── provider_service.py     — API Provider CRUD、配置合并、认证处理
│   ├── runninghub_service.py   — RunningHub 工作流提交
│   └── update_service.py       — GitHub 自动更新 + 备份 + 回滚 + 自重启
├── server/routes/              — FastAPI APIRouter（薄层，含必要的 late import）
│   ├── files.py                — GET /, /api/view, /api/upload 等（8 个路由）
│   ├── chat.py                 — POST /api/chat, /api/chat/stream
│   ├── canvas.py               — /api/canvases CRUD
│   ├── canvas_video.py         — POST /api/canvas-video
│   ├── canvas_llm.py           — POST /api/canvas-llm
│   ├── online_image.py         — POST /api/online-image
│   ├── comfyui_generate.py     — POST /api/generate（本地 ComfyUI）
│   ├── ms_generate.py          — POST /generate, /api/ms/generate（ModelScope）
│   ├── angle.py                — POST /api/angle/generate
│   ├── history.py              — GET /api/history
│   ├── conversation.py         — /api/conversations CRUD
│   ├── workflow.py             — /api/workflows CRUD + /api/workflows/{name}/run
│   ├── provider.py             — /api/providers, /api/comfyui/instances
│   ├── runninghub.py           — /api/runninghub/*
│   ├── asset_library.py        — /api/asset-library/*
│   └── update.py               — /api/update-from-github, /api/update-rollback
└── server/ws/
    └── manager.py              — ConnectionManager（WebSocket 广播 + 在线统计）
```

**重要模式：**
- 路由模块通过 late import 访问 `main.py` 中的共享可变状态：
  - `from main import GLOBAL_LOOP` — 异步事件循环引用（用于跨线程广播）
  - `from main import QUEUE, QUEUE_LOCK, NEXT_TASK_ID` — ComfyUI 任务队列
  - `from main import CANVAS_TASKS, CANVAS_TASK_LOCK` — 画布后台任务追踪
- 路由模块可互相引用：`from server.routes.comfyui_generate import generate`
- `main.py` 行首有 `sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))`，确保项目自带 Python 可找到 `server` 包

### 前端 (static/)

#### 原生 JS/HTML（存量）
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

#### Vue 3 + TypeScript + Vite（渐进迁移）

```
src/
├── shared/                     — 框架无关的公共模块
│   ├── api-client.ts           — HTTP 客户端（get/post/uploadFile/streamSSE）
│   ├── ws-client.ts            — WebSocket 单例
│   ├── i18n/engine.ts          — i18n 引擎（TypeScript 版）
│   └── types/api.ts            — 前端 API 类型契约
├── components/                 — 共享 Vue 组件
├── pages/
│   ├── api-settings/           — ✅ 已迁移
│   ├── comfyui-settings/       — 待迁移
│   └── canvas-app/             — 待创建（SPA 骨架）
```

Vite 开发服务器端口 5173，自动 proxy `/api` 和 `/ws` 到 FastAPI 后端。构建产物输出到 `static/dist/`。

### 数据流

```
API 请求 → FastAPI 路由 (server/routes/) → 调用 AI Provider / ComfyUI
                                              ↓
                                    写入 HistoryStore（全局历史）
                                    通过 WebSocket 广播通知在线客户端
                                    媒体文件下载到 assets/output/
```

### 配置体系

- `API/.env` — API Key 和环境变量（启动时加载到 `os.environ`）
- `server/config.py` — 所有路径常量和配置变量（从环境变量读取）
- `data/api_providers.json` — UI 可管理的 API 提供商列表
- `VERSION` — 版本号文件（用于自动更新检测）
- `global_config.json` — 全局配置（主题、语言等）
- `data/asset_library.json` — 素材库

### 关键全局变量

**`server/config.py`（配置常量）：**
- `COMFYUI_INSTANCES` — ComfyUI 后端地址列表（从 `.env` 读取，默认 `127.0.0.1:8188`）
- `MODELSCOPE_API_KEY` — ModelScope API 密钥
- `AI_BASE_URL` / `AI_API_KEY` — 通用 AI 后端（默认 `https://ai.comfly.chat`）
- `BACKEND_LOCAL_LOAD` / `LOAD_LOCK` — 多 ComfyUI 实例负载计数

**`main.py`（共享可变状态，路由模块通过 late import 访问）：**
- `GLOBAL_LOOP` — asyncio 事件循环引用
- `QUEUE` / `QUEUE_LOCK` / `NEXT_TASK_ID` — ComfyUI 生成任务队列
- `CANVAS_TASKS` / `CANVAS_TASK_LOCK` — 画布后台任务追踪

### 离线包

`packages/` 目录包含所有 Python 依赖的 `.whl` 文件，`安装依赖.bat` 和 `mac-安装依赖.sh` 优先离线安装。

### 注意事项

- 前端存量 JS 文件通过 `<script>` 标签直接加载，没有模块打包器（无 webpack）；新页面使用 Vite 构建
- 所有数据以 JSON 文件持久化，无数据库
- `main.py` 启动时会自动同步 `static/*.html` 中的版本查询参数（`?v=...`）用于缓存破坏
- Canvas assets 的二进制文件（图片等）存储在 `assets/library/` 和画布 JSON 的 base64 内嵌中
- `.gitignore` 排除了 `data/`、`api/`、`assets/`、`history.json`、`workflows/custom/`，这些是运行时产生的用户数据
- 新增或修改 `server/` 下的模块后，务必运行 `python -c "from main import app"` 验证导入无循环依赖
