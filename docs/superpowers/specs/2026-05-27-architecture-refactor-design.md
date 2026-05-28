# Infinite-Canvas 架构重构设计文档

**日期：** 2026-05-28
**版本：** 1.3（基于 upstream d86663c 更新，Loop 视频输入 + 媒体通用化）

## 1. 动机

当前项目存在以下结构性问题：

- **后端**：单文件 `main.py`（~7230 行），包含所有路由、业务逻辑、数据访问、Provider 调用，难以维护和测试。每次功能迭代（LLM 反推视频、火山引擎 Seedance2 适配、Loop 视频输入、媒体上传通用化）都在继续加重单文件负担。
- **前端**：10 个独立 HTML 页面，对应的 JS 文件过于庞大（`canvas.js` 487KB，`smart-canvas.js` 458KB），无模块化、无类型检查、无构建工具。
- **数据层**：JSON 文件直接读写，并发写入存在损坏风险，history.json 持续膨胀无归档。

## 2. 设计决策

| 维度 | 选择 | 理由 |
|------|------|------|
| 后端架构 | Service 层抽象（~15 模块） | 路由薄层 + Service 业务逻辑 + Provider 适配器的三层结构 |
| 前端框架 | Vue 3 + TypeScript + Vite | 组件化开发，类型安全，渐进迁移友好 |
| 前端结构 | 核心画布 SPA + 其他独立入口 | 降低迁移风险，允许新旧共存 |
| 数据存储 | JSON 文件 + 原子写入 | 零外部依赖，加 write-then-rename 保证数据安全 |
| Provider | ABC 基类 + 注册表 | 新增 AI 后端只需加一个文件 |

## 3. 后端设计

### 3.1 目录结构

```
server/
├── main.py                  # FastAPI 启动 + app 创建 + 生命周期
├── config.py                # 环境变量读取 + 全局配置常量
├── exceptions.py            # 自定义异常类
│
├── models/                  # Pydantic 请求/响应模型
│   ├── generation.py        # GenerateRequest, CloudGenRequest, OnlineImageRequest
│   ├── chat.py              # ChatRequest, ConversationCreateRequest
│   ├── canvas.py            # CanvasCreateRequest, CanvasSaveRequest
│   ├── workflow.py          # WorkflowUploadRequest, WorkflowRunRequest
│   └── provider.py          # ApiProviderPayload, TestConnectionPayload
│
├── routes/                  # FastAPI 路由（薄层，≤200 行/文件）
│   ├── generation.py        # POST /api/online-image, /api/generate, /generate, /api/ms/generate
│   ├── chat.py              # POST /api/chat, /api/chat/stream
│   ├── canvas.py            # /api/canvas*, /api/canvases*, /api/smart-canvas/*
│   ├── workflow.py           # /api/workflows/*
│   ├── provider.py           # /api/providers/*
│   └── update.py            # /api/update-from-github, /api/update-rollback
│
├── services/                # 业务逻辑（不依赖 FastAPI）
│   ├── image_service.py     # 生图通用逻辑：参数处理、轮询、结果下载
│   ├── chat_service.py      # 对话管理：历史处理、上下文构建、SSE streaming
│   ├── canvas_service.py    # 画布 CRUD、软删除恢复、资源清理
│   ├── workflow_service.py  # ComfyUI 工作流管理
│   ├── provider_service.py  # API Provider 配置管理
│   ├── runninghub_service.py# RunningHub 提交/查询
│   └── media_service.py     # 媒体处理：视频抽帧(ffmpeg)、图片压缩、data URL 转换、云端上传
│
├── providers/               # AI 后端适配器（ABC 基类 + 注册表）
│   ├── base.py              # BaseProvider ABC: generate_image(), poll_task()
│   ├── openai.py            # OpenAI 协议实现
│   ├── apimart.py           # APIMart 异步协议：veo31 时长/分辨率适配
│   ├── gemini.py            # Gemini 实现
│   ├── volcengine.py        # 火山引擎：Seedance2 适配、视频参数、asset:// URI
│   ├── runninghub.py        # RunningHub 实现
│   └── modelscope.py        # ModelScope Z-Image / Qwen 系列
│
├── data/                    # JSON 文件存储（原子写入）
│   ├── base_store.py        # JsonStore 基类：_atomic_write(), read()
│   ├── history_store.py     # HistoryStore: add(), list(), delete(), 自动归档
│   ├── canvas_store.py      # CanvasStore: save(), load(), list(), trash()
│   ├── conversation_store.py# ConversationStore
│   └── asset_store.py       # AssetStore: 素材库资源管理
│
└── ws/                      # WebSocket
    └── manager.py           # ConnectionManager：状态广播、画布同步
```

### 3.2 分层规则

- **Route 层**：参数校验 + 委托 Service + 格式化响应 + 处理 HTTPException。不包含业务逻辑。
- **Service 层**：纯 Python，不 import FastAPI 任何对象。返回自定义异常或 Result 类型，由 Route 转为 HTTP 响应。
- **Data 层**：所有 JSON 读写通过 `base_store.JsonStore` 进行，确保原子写入。
- **Provider 层**：通过 ABC 基类定义统一接口，注册表模式自动发现。

### 3.3 原子写入模式

```python
class JsonStore:
    def _atomic_write(self, data: dict):
        """
        write → .tmp → os.replace(.bak) → os.replace(.tmp → target)
        在任何一步崩溃，原文件数据都完整无损。
        """
        tmp = self._path + ".tmp"
        bak = self._path + ".bak"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        if os.path.exists(self._path):
            os.replace(self._path, bak)   # 保留上一份备份
        os.replace(tmp, self._path)        # 原子替换（Windows 上也是原子的）
```

### 3.4 History 归档策略

- `HistoryStore` 每次写入后检查条目数
- 超过 30 天的记录自动归档到 `data/history_archive/YYYY-MM.json`
- 主 `history.json` 保证只包含最近 30 天 + 最多 1000 条
- 归档文件按需加载，不阻塞主流程

### 3.5 Provider 注册表

```python
# providers/base.py
class BaseProvider(ABC):
    @abstractmethod
    async def generate_image(self, params: ImageGenParams) -> ImageResult: ...
    @abstractmethod
    async def poll_task(self, task_id: str) -> TaskStatus: ...

# 自动注册
_PROVIDER_REGISTRY: dict[str, type[BaseProvider]] = {}

def register_provider(protocol: str):
    def decorator(cls):
        _PROVIDER_REGISTRY[protocol] = cls
        return cls
    return decorator

# 使用
provider_cls = _PROVIDER_REGISTRY[protocol]
provider = provider_cls(config)
```

## 4. 前端设计

### 4.1 目录结构

```
src/
├── shared/                      # 框架无关模块（零依赖，纯 TS → ES 模块）
│   ├── api-client.ts            # HTTP 请求封装：get, post, uploadFile, streamSSE
│   ├── ws-client.ts             # WebSocket 单例
│   ├── i18n/
│   │   ├── engine.ts            # t(), setLang(), register()
│   │   ├── zh-CN.ts
│   │   └── en.ts
│   ├── types/
│   │   ├── api.ts               # API 请求/响应 TS 接口
│   │   ├── canvas.ts            # 画布节点/连接/视口类型
│   │   └── provider.ts          # API Provider 配置类型
│   └── utils/
│       ├── image.ts             # 图片下载/预览/base64 处理
│       └── format.ts            # 时间/文件大小格式化
│
├── canvas-app/                  # 核心画布 SPA（Vue Router）
│   ├── router.ts
│   ├── App.vue
│   ├── stores/                  # Pinia
│   │   ├── useCanvas.ts         # nodes[], connections[], viewport
│   │   ├── useSelection.ts
│   │   └── useHistory.ts        # undo/redo
│   ├── nodes/                   # 节点类型组件（动态渲染）
│   │   ├── types.ts             # 节点类型注册表
│   │   ├── BaseNode.vue         # 基组件（拖拽/缩放/连接点）
│   │   ├── ImageGenNode.vue
│   │   ├── LLMNode.vue           # 大模型节点（文本+图片+视频输入）
│   │   ├── ImageInputNode.vue
│   │   ├── VideoNode.vue
│   │   ├── TextNode.vue
│   │   ├── NoteNode.vue
│   │   ├── GroupNode.vue
│   │   └── LoopNode.vue           # 循环节点（图片+视频批量输入）
│   ├── components/
│   │   ├── CanvasViewport.vue   # 无限画布视口（pan/zoom）
│   │   ├── ConnectionLayer.vue  # SVG 连线层
│   │   ├── MiniMap.vue
│   │   ├── NodePanel.vue
│   │   └── Toolbar.vue
│   ├── composables/
│   │   ├── useNodeDrag.ts
│   │   ├── useConnection.ts
│   │   └── useCanvasZoom.ts
│   └── views/
│       ├── CanvasEditor.vue
│       └── SmartCanvas.vue
│
├── components/                  # 共享 UI 组件（多个页面共用）
│   ├── ImagePreview.vue
│   ├── PromptInput.vue
│   ├── HistoryPanel.vue
│   └── ModelSelector.vue
│
└── pages/                       # 独立页面入口
    ├── api-settings/
    │   └── index.ts
    ├── comfyui-settings/
    │   └── index.ts
    ├── online/
    │   └── index.ts
    ├── enhance/
    │   └── index.ts
    ├── zimage/
    │   └── index.ts
    ├── klein/
    │   └── index.ts
    ├── angle/
    │   └── index.ts
    └── gpt-chat/
        └── index.ts
```

### 4.2 Vite 多入口配置

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        'canvas-app': resolve(__dirname, 'src/canvas-app/index.html'),
        'api-settings': resolve(__dirname, 'src/pages/api-settings/index.html'),
        'comfyui-settings': resolve(__dirname, 'src/pages/comfyui-settings/index.html'),
        // ... 其他独立页面
      }
    }
  }
})
```

### 4.3 新旧共存

- 迁移期间，`static/` 保留旧 HTML 页面
- Vite 编译输出到 `static/dist/`
- FastAPI `StaticFiles` 同时挂载两个目录
- 旧页面通过 `<script type="module">` import `src/shared/` 编译后的模块
- `src/shared/` 不依赖任何框架，确保新旧两套都能使用

### 4.4 画布节点动态渲染

```vue
<!-- CanvasViewport.vue -->
<template>
  <div class="viewport" @wheel="zoom" @mousedown="pan">
    <component
      v-for="node in canvasStore.nodes"
      :key="node.id"
      :is="nodeRegistry[node.type]"
      v-bind="node.props"
      @update="canvasStore.updateNode(node.id, $event)"
    />
    <ConnectionLayer :connections="canvasStore.connections" />
  </div>
</template>
```

### 4.5 类型同步

- 初期手动维护 `src/shared/types/api.ts` 与后端 Pydantic model 对应
- Phase 3 配置 `openapi-typescript` 从 FastAPI 自动生成的 `/openapi.json` 生成 TS 类型，实现零偏差

## 5. 迁移策略

### Phase 0：基础设施（不碰业务代码）

| 步骤 | 内容 | 验证方式 |
|------|------|----------|
| 0.1 | 创建 `server/` 目录，抽取 `config.py`、`exceptions.py` | 服务正常启动 |
| 0.2 | 创建 `data/base_store.py` + `history_store.py`，替换 main.py 中的直接文件读写 | history 读写正常 |
| 0.3 | 初始化 Vite + Vue 3 项目，创建 `src/shared/`（api-client, ws-client, i18n, types） | `npm run build` 通过 |
| 0.4 | main.py 中 import 新的 store 模块 | 全功能测试无回归 |

### Phase 1：后端模块拆分

| 步骤 | 内容 | 验证方式 |
|------|------|----------|
| 1.1 | 抽取 Pydantic models 到 `server/models/` | 请求校验正常 |
| 1.2 | 抽取 Provider 适配器到 `server/providers/`，优先提取火山引擎（volcengine_video_duration/resolution/role/media_reference_url 等独立函数）和 ModelScope | 各 AI 后端调用正常 |
| 1.3 | 拆分 Service 层（image、chat、canvas、workflow 四个核心先拆） | 单元测试可通过 |
| 1.4 | 拆分路由层到 `server/routes/` | API 响应无变化 |
| 1.5 | main.py 瘦身为入口文件 | 行数从 7000 → ~100 |

### Phase 2：前端逐页迁移

| 步骤 | 内容 | 验证方式 |
|------|------|----------|
| 2.1 | 迁移 api-settings（复杂度已从 ~100 行 CSS 暴涨到 ~2600 行，优先迁移以控制膨胀） | 页面功能无变化 |
| 2.2 | 迁移 comfyui-settings | 页面功能无变化 |
| 2.3 | 迁移简单生图页面（online / zimage / klein / enhance）| 各页面功能无变化 |
| 2.4 | 迁移 gpt-chat | 对话功能无变化 |
| 2.5 | 迁移 angle（LTX 时间线） | 时间线编辑正常 |
| 2.6 | 迁移画布（canvas + smart-canvas 合并 SPA），LLMNode 需支持视频抽帧预览和 asset:// URI | 画布编辑正常 |

### Phase 3：质量加固

| 步骤 | 内容 | 验证方式 |
|------|------|----------|
| 3.1 | 配置 openapi-typescript 自动生成 TS 类型 | 类型检查无错误 |
| 3.2 | 给 Service 层补充 pytest 单元测试 | `pytest` 全部通过 |
| 3.3 | 配置 ESLint + Prettier + pre-commit hook | git commit 触发检查 |

## 6. 上游同步策略

重构后 `main.py` 拆分为 15 个模块，上游更新仍然改的是 `main.py` 单文件。需要一套机制将上游改动高效移植到新架构。

### 6.1 函数级映射表

重构时生成 `upstream-map.json`，记录每个上游函数/类归属的新文件：

```json
{
  "version": "2026.05.27.1",
  "mappings": {
    "generate_cloud":            "server/routes/generation.py",
    "generate_ai_image":         "server/services/image_service.py",
    "canvas_video":              "server/routes/canvas.py",
    "canvas_llm":                "server/routes/canvas.py",
    "chat":                      "server/routes/chat.py",
    "ConnectionManager":         "server/ws/manager.py",
    "video_reference_to_frame_data_urls": "server/services/media_service.py",
    "volcengine_video_duration": "server/providers/volcengine.py",
    "CanvasLLMRequest":          "server/models/canvas.py",
    "GenerateRequest":           "server/models/generation.py"
  }
}
```

### 6.2 同步流程

| 步骤 | 操作 |
|------|------|
| 1 | `git fetch upstream` 拉取上游新提交 |
| 2 | `git diff upstream/main...HEAD -- main.py` 查看 main.py 改动 |
| 3 | 看 diff 中改动的函数名/类名，查映射表找到目标文件 |
| 4 | 手动移植改动到对应的新文件（改动通常几十行） |
| 5 | 如果 diff 包含新函数：判断归属（provider/service/route），移植代码并更新映射表 |
| 6 | 更新映射表 version 字段，标记已同步到的上游版本 |

### 6.3 静态文件分类处理

| 上游改了什么 | 处理方式 |
|-------------|---------|
| 尚未迁移的 HTML/JS/CSS | 直接覆盖 static/，无冲突 |
| 已迁移到 Vue 的页面 | 需要手动移植到 src/ 对应组件 |
| 共享模块（i18n 等） | 更新 src/shared/ 对应文件 |

### 6.4 可行性

- 80% 的上游改动是修改已有函数内部逻辑 → 函数名不变，映射表直接定位
- 10% 是新增函数 → 根据代码内容归类，更新映射表（加一条记录）
- 映射表约 80-100 条，重构时一次性生成，维护成本极低

## 7. 风险与缓解（更新）

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 后端循环导入 | 服务无法启动 | 延迟导入（`import` 放在函数内）+ 按依赖方向组织文件（data → providers → services → routes → main） |
| 画布迁移复杂度被低估 | 迁移周期过长 | 画布放在 Phase 2 最后，先积累迁移经验；保持旧 canvas.html 作为 fallback |
| 新旧页面 i18n 不一致 | 用户看到混合语言 | `src/shared/i18n/` 使用同一套 key，新旧页面共享 dict |
| WebSocket 连接重复 | 重复通知 | `ws-client.ts` 实现为单例，多个页面 import 得到同一个连接实例 |
| Vite 热更新与 FastAPI 代理冲突 | 开发体验差 | Vite dev server 独立运行（端口 5173），FastAPI 静态文件只在生产模式使用 |
| 上游更新后遗漏移植 | 新功能缺失或 bug 修复未生效 | upstream-map.json 映射表 + 每次同步后运行功能测试；version 字段追踪同步进度 |

## 7. 验证标准

- 重构后所有现有功能无回归
- `main.py` 从 ~7000 行缩减为 ~100 行入口文件
- 每个后端模块 ≤ 300 行
- 每个 Vue 组件 ≤ 200 行
- TypeScript 编译零错误（`tsc --noEmit`）
- 画布节点可独立开发和测试

## 9. 上游变更追踪

| 上游 commit | 日期 | 变更摘要 | 对重构方案的影响 |
|------------|------|---------|----------------|
| `d86663c` | 05-27 | 运行说明更新 | 无影响 |
| `201b21e` | 05-27 | sync app code 2026.05.27.2 — Seedance2 适配、APIMart veo3.1 时长、媒体上传通用化 | `is_volcengine_seedance2_model` → providers/volcengine.py；`apimart_veo31_duration` → providers/apimart.py；`local_media_path_for_cloud_upload` → services/media_service.py |
| `c4337a6` | 05-27 | Merge PR #43 | 无影响 |
| `6e1b383` | 05-27 | feat(canvas): Loop 节点支持视频输入 | canvas.js Loop 节点新增 videoInput/videoBatchSize 字段；新增 i18n key 4 个；媒体上传从视频专用改为通用 |
| `bb2a725` | 05-27 | sync app code 2026.05.27.1 — LLM 反推视频、火山引擎视频增强 | 本次重构的基线版本 |
