# 前端重构进度报告

> 2026-05-28 — canvas.js 模块化拆分进度

## 基线

| 文件 | 原始行数 |
|------|----------|
| canvas.js | ~10,567 |
| smart-canvas.js | ~9,200 |

## 已完成

### 模块提取（canvas.js）

| 模块 | 文件 | 行数 | 内容 |
|------|------|------|------|
| 工具函数 | `static/js/canvas/utils.js` | 261 | `uid`, `escapeHtml`, `copyTextToClipboard`, `parseSizePair`, `gcdInt`, `parseSizeValue`, `isRemoteVideoReferenceUrl`, `isVideoUrl` 等 |
| Provider/模型选择 | `static/js/canvas/providers.js` | 354 | `imageModelOptions`, `chatModelOptions`, `videoModelOptions`, `getApiProvider`, `providerSupportsImageGen` 等 27 个函数 |
| RunningHub 引擎 | `static/js/canvas/engine-runninghub.js` | 1,009 | RH 工作流/应用管理、参数解析、媒体上传、任务提交/轮询 ~48 个函数 |
| 图片编辑器 | `static/js/canvas/image-editor.js` | 1,191 | 裁剪、outpaint、遮罩、画笔、宫格切分、缩放 68 个函数 |

### canvas.js 瘦身进度

- **原始:** ~10,567 行
- **当前:** 8,711 行
- **已提取:** ~2,815 行（4 个模块）
- **缩减比例:** ~17.6%

### smart-canvas.js 清理

- 删除 4 个与 utils.js 重复的函数: `parseSizePair`, `gcdInt`, `parseSizeValue`, `isRemoteVideoReferenceUrl`
- 当前: 9,450 行（原始 ~9,200 + 新增功能增长）

### HTML 加载顺序

`canvas.html` 通过 `<script defer>` 按序加载：
1. `utils.js`
2. `providers.js`
3. `engine-runninghub.js`
4. `image-editor.js`
5. `ltx-director-timeline.js`
6. `canvas.js`

`smart-canvas.html` 按序加载：
1. `utils.js`
2. `providers.js`
3. `smart-canvas.js`

### 架构模式

- **IIFE 隔离:** `(function(){ 'use strict'; ... })();`
- **状态同步:** `window.CanvasState` — canvas.js 通过 `syncCanvasState()` 同步 `nodes`, `connections`, `selected`, `apiProviders`, `imageModels`, `chatModels`, `videoModels`, `models`, `runningHubWorkflowCache` 等
- **函数桥接:** `window.CanvasApi` — canvas.js 暴露 27 个内部函数（`render`, `scheduleSave`, `appendOutputImages`, `mediaKindForNode`, `exceedsFourKStandard` 等）
- **懒访问器:** `function A() { return window.CanvasApi || {}; }` — 处理模块先于 canvas.js 加载的时序问题
- **全局导出:** `window.ModuleName = {...}` + `window[key] = fn`（onclick 兼容）

### 后端修复

- `server/services/runninghub_service.py`: 补全 7 个缺失导入（`uuid`, `OUTPUT_INPUT_DIR`, `OUTPUT_OUTPUT_DIR`, `get_api_provider_exact`, `runninghub_wallet_key_env`, `normalize_provider`, `load_static_runninghub_provider`）
- `server/routes/runninghub.py`: 补全 `now_ms` 导入
- `server/models/provider.py`: 新增 `RunningHubWorkflowConfigField.min/max/step/imageOrder/required` 字段

---

## 待完成

### canvas.js 剩余可提取模块（按行数排序）

| 优先级 | 模块 | 估算行数 | 独立程度 | 说明 |
|--------|------|----------|----------|------|
| P0 | 级联引擎 (cascade) | ~600 | 高 | Cascade 状态管理、顺序计算、循环解析、按钮渲染 |
| P1 | 拖放/上传系统 | ~550 | 高 | 文件检测、DataTransfer 解析、多文件上传、本地导入 |
| P2 | Loop 节点 | ~530 | 中 | 循环体渲染、输入收集、自动尺寸 |
| P3 | MS/ModelScope | ~440 | 中 | MS 节点渲染、参数面板、生成运行 |
| P4 | ComfyUI 集成 | ~480 | 中 | 节点渲染、设置面板、自定义字段、生成运行 |
| P5 | LTX Director | ~480 | 中-高 | 时间线解析、Relay 构建、Payload 生成、节点渲染（依赖 `CanvasLTXTimelineEditor`） |
| P6 | LLM 节点 | ~270 | 中 | 聊天面板渲染、SSE 调用 |
| P7 | 视频节点 | ~260 | 中 | 视频节点渲染、参数配置、生成运行 |
| P8 | 输出 Lightbox | ~235 | 中 | 预览、对比滑块、提示词面板、缩放/拖拽 |
| P9 | Generator 节点 | ~300 | 中 | 生成器面板渲染、输入列表、提示词预览 |
| P10 | 菜单系统 | ~330 | 中 | 创建菜单、链接菜单、Generator 菜单、图片节点菜单 |

### 核心区（不建议提取）

以下区域与 canvas.js 内部状态深度耦合，强行提取会增加桥接复杂度，ROI 低：
- DOM 引用 + 全局状态变量（~240 行）
- Canvas Gate/画布列表 CRUD（~790 行）
- 保存/同步/远程轮询（~150 行）
- 视口/Minimap（~95 行）
- 节点工厂函数（~190 行）
- 主渲染引擎 render/renderNode/refreshNodes（~330 行）
- 事件处理：拖拽/缩放/键盘/链接渲染（~900 行）

### smart-canvas.js 待清理

- `uid` — 与 utils.js 重复，但 smart-canvas.js 版本使用不同的参数签名
- `parseRatioValue` — canvas.js 中无完全相同函数
- `imageRefsOnly`/`videoRefsOnly`/`audioRefsOnly` — 特定智能画布逻辑
- `isSupportedUploadFile` — 智能画布特有
- 10 个 Provider 函数 — 使用不同的状态模型（本地 `apiProviders` + `settings`），与 providers.js 不兼容

### 后端待办

- [ ] 服务重启后验证 RunningHub 上传/工作流拉取 500 错误是否修复
- [ ] 检查其他路由是否有类似的缺失导入问题
