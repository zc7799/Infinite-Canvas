# Infinite-Canvas 架构重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ~7000 行单文件 main.py 拆分为 ~15 模块的三层架构（Route/Service/Provider），前端引入 Vue 3 + TypeScript + Vite 渐进迁移。

**Architecture:** 后端采用 Route → Service → Data 三层，AI Provider 使用 ABC 基类 + 注册表模式。前端 Vite 多入口构建，核心画布合并 SPA，其他页面独立入口，通过框架无关的 `src/shared/` 实现新旧共存。

**Tech Stack:** Python 3.10+, FastAPI, httpx, Pydantic / Vue 3, TypeScript, Vite, Pinia

**基线:** main.py 6957 行，canvas.js 10777 行，smart-canvas.js 9212 行

---

### Task 1: 创建 server/ 目录骨架和 config.py

**Files:**
- Create: `server/__init__.py`
- Create: `server/config.py`
- Create: `server/exceptions.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/__init__.py`**

```python
# server/__init__.py
```

- [ ] **Step 2: 创建 `server/config.py`**

将 main.py 中 L1-L39（import）、L169-L367（配置区域）、L395-L400（超时常量）、L987（BACKEND_LOCAL_LOAD）提取到此文件。

```python
# server/config.py
import os
import re

# --- 路径常量 ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "Z-Image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
STATIC_RUNNINGHUB_DIR = os.path.join(STATIC_DIR, "runninghub")
STATIC_RUNNINGHUB_THUMBNAIL_DIR = os.path.join(STATIC_RUNNINGHUB_DIR, "thumbnails")
STATIC_RUNNINGHUB_API_PROVIDERS_FILE = os.path.join(STATIC_RUNNINGHUB_DIR, "api_providers.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_INPUT_DIR = os.path.join(ASSETS_DIR, "input")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
ASSET_LIBRARY_DIR = os.path.join(ASSETS_DIR, "library")
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONVERSATION_DIR = os.path.join(DATA_DIR, "conversations")
CANVAS_DIR = os.path.join(DATA_DIR, "canvases")
ASSET_LIBRARY_PATH = os.path.join(DATA_DIR, "asset_library.json")
API_PROVIDERS_FILE = os.path.join(DATA_DIR, "api_providers.json")
RUNNINGHUB_WORKFLOW_STORE_FILE = os.path.join(DATA_DIR, "runninghub_workflows.json")
GLOBAL_CONFIG_FILE = os.path.join(BASE_DIR, "global_config.json")
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
RUNNINGHUB_THUMBNAIL_EXTS = (".jpg",)

# --- 环境变量 ---
def load_env_file():
    """从 API/.env 加载环境变量"""
    if not os.path.exists(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, 'r', encoding='utf-8-sig') as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as e:
        print(f"加载 API/.env 失败: {e}")

load_env_file()

COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_MEDIA_BASE_URL = os.getenv("PUBLIC_MEDIA_BASE_URL", "").strip().rstrip("/")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"

# ... 其余配置常量（MODELSCOPE_DEFAULT_IMAGE_MODELS, CHAT_MODELS 等）
# 完整代码从 main.py L169-L400 按原样移植
```

- [ ] **Step 3: 创建 `server/exceptions.py`**

```python
# server/exceptions.py

class AppError(Exception):
    """业务异常基类"""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class ProviderError(AppError):
    """AI Provider 调用异常"""

class MediaError(AppError):
    """媒体处理异常"""
```

- [ ] **Step 4: 修改 main.py，改为从 server.config 导入**

```python
# main.py 顶部修改
from server.config import (
    COMFYUI_INSTANCES, COMFYUI_ADDRESS, MODELSCOPE_API_KEY,
    AI_BASE_URL, AI_API_KEY, WORKFLOW_DIR, WORKFLOW_PATH,
    STATIC_DIR, OUTPUT_DIR, ASSETS_DIR, DATA_DIR,
    HISTORY_FILE, GLOBAL_CONFIG_FILE, CANVAS_TRASH_RETENTION_MS,
    # ... 其他需要的常量
)
from server.exceptions import AppError, ProviderError, MediaError
```

- [ ] **Step 5: 验证服务正常启动**

```bash
python main.py
# 预期: 服务正常运行在 http://127.0.0.1:3000/
```

- [ ] **Step 6: 提交**

```bash
git add server/__init__.py server/config.py server/exceptions.py main.py
git commit -m "refactor(server): extract config and exceptions from main.py"
```

---

### Task 2: 创建 JSON Store 原子写入基类

**Files:**
- Create: `server/data/__init__.py`
- Create: `server/data/base_store.py`
- Create: `server/data/history_store.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/data/base_store.py`**

```python
# server/data/base_store.py
import json
import os
import threading
from typing import Any, Dict


class JsonStore:
    """原子写入 + 自动备份的 JSON 文件存储基类"""

    def __init__(self, filepath: str, initial: Dict[str, Any] = None):
        self._path = filepath
        self._lock = threading.Lock()
        if initial is None:
            initial = {}
        if not os.path.exists(filepath):
            self._atomic_write(initial)

    def _atomic_write(self, data: dict) -> None:
        tmp = self._path + ".tmp"
        bak = self._path + ".bak"
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        if os.path.exists(self._path):
            try:
                os.replace(self._path, bak)
            except OSError:
                pass
        os.replace(tmp, self._path)

    def _read_all(self) -> dict:
        if not os.path.exists(self._path):
            return {}
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            bak = self._path + ".bak"
            if os.path.exists(bak):
                with open(bak, "r", encoding="utf-8") as f:
                    return json.load(f)
            return {}

    def _write_all(self, data: dict) -> None:
        with self._lock:
            self._atomic_write(data)
```

- [ ] **Step 2: 创建 `server/data/history_store.py`**

```python
# server/data/history_store.py
import os
import time
import json
from .base_store import JsonStore


class HistoryStore(JsonStore):
    ARCHIVE_DIR_NAME = "history_archive"
    MAX_AGE_DAYS = 30
    MAX_ITEMS = 1000

    def __init__(self, filepath: str, data_dir: str):
        super().__init__(filepath, initial={"items": []})
        self._archive_dir = os.path.join(data_dir, self.ARCHIVE_DIR_NAME)

    def _archive_old(self, data: dict) -> dict:
        cutoff = time.time() - self.MAX_AGE_DAYS * 86400
        items = data.get("items", [])
        recent, old = [], []
        for item in items:
            (old if item.get("timestamp", 0) < cutoff else recent).append(item)
        if old and len(old) > 0:
            ym = time.strftime("%Y-%m", time.localtime(old[0].get("timestamp", time.time())))
            archive_path = os.path.join(self._archive_dir, f"{ym}.json")
            os.makedirs(self._archive_dir, exist_ok=True)
            existing = []
            if os.path.exists(archive_path):
                try:
                    with open(archive_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except Exception:
                    pass
            existing.extend(old)
            with open(archive_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
        data["items"] = recent[:self.MAX_ITEMS]
        return data

    def add(self, record: dict) -> None:
        record["timestamp"] = record.get("timestamp", time.time())
        with self._lock:
            data = self._read_all()
            data["items"] = data.get("items", [])
            data["items"].append(record)
            if len(data["items"]) > self.MAX_ITEMS:
                data = self._archive_old(data)
            self._atomic_write(data)

    def list(self, limit: int = 100, offset: int = 0) -> list:
        data = self._read_all()
        items = data.get("items", [])
        return sorted(items, key=lambda x: x.get("timestamp", 0), reverse=True)[offset:offset + limit]

    def delete_by_timestamp(self, ts: float) -> None:
        with self._lock:
            data = self._read_all()
            data["items"] = [item for item in data.get("items", []) if item.get("timestamp") != ts]
            self._atomic_write(data)

    def count(self) -> int:
        return len(self._read_all().get("items", []))
```

- [ ] **Step 3: 修改 main.py，替换 save_to_history() 和 load_history()**

在 main.py 中找到 `save_to_history()` 函数 (L1864) 和 `HISTORY_LOCK`，替换为使用 HistoryStore：

```python
from server.data.history_store import HistoryStore
from server.config import HISTORY_FILE, DATA_DIR

_history_store = HistoryStore(HISTORY_FILE, DATA_DIR)

def save_to_history(record):
    _history_store.add(record)
```

找到 `@app.get("/api/history")` 路由，修改为：

```python
@app.get("/api/history")
async def get_history():
    return {"items": _history_store.list(limit=200)}
```

- [ ] **Step 4: 验证 history 读写正常**

```bash
curl http://127.0.0.1:3000/api/history
# 预期: 返回历史记录 JSON
```

- [ ] **Step 5: 提交**

```bash
git add server/data/ main.py
git commit -m "refactor(data): add JsonStore base and HistoryStore with atomic write"
```

---

### Task 3: 创建 Pydantic Models 模块

**Files:**
- Create: `server/models/__init__.py`
- Create: `server/models/generation.py`
- Create: `server/models/chat.py`
- Create: `server/models/canvas.py`
- Create: `server/models/workflow.py`
- Create: `server/models/provider.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/models/generation.py`**

从 main.py L1437-L1480 提取：
- `GenerateRequest`, `CloudGenRequest`, `CloudPollRequest`
- `OnlineImageRequest`, `AIReference`
- `CanvasVideoRequest`, `TempShUploadRequest`, `CloudVideoUploadRequest`

```python
# server/models/generation.py
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


ONLINE_IMAGE_PROMPT_MAX_LENGTH = 4000
VIDEO_PROMPT_MAX_LENGTH = 3000


class GenerateRequest(BaseModel):
    prompt: str = ""
    width: int = 1024
    height: int = 1024
    workflow_json: str = "Z-Image.json"
    params: Dict[str, Any] = {}
    type: str = "zimage"
    client_id: str = ""
    convert_to_jpg: bool = False


class AIReference(BaseModel):
    url: str = ""
    name: str = ""
    role: str = ""


class OnlineImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = ""
    size: str = "1024x1024"
    quality: str = "auto"
    n: int = 1
    reference_images: List[AIReference] = []


class CloudGenRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = ""
    resolution: str = "1024x1024"
    type: str = "zimage"
    image_urls: List[str] = []
    loras: Optional[Any] = None
    client_id: Optional[str] = None


class CloudPollRequest(BaseModel):
    task_id: str
    api_key: str = ""
    client_id: Optional[str] = None


class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=VIDEO_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = "veo3-fast"
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[AIReference] = []
    videos: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False
    return_last_frame: bool = False
    generate_audio: bool = False


class TempShUploadRequest(BaseModel):
    url: str = ""


class CloudVideoUploadRequest(BaseModel):
    url: str = ""
    service: str = "auto"
```

- [ ] **Step 2: 创建其他 model 文件**

`server/models/chat.py` — 从 L1450-1451, L1575-L1611 提取 `TokenRequest`, `ChatRequest`, `ConversationCreateRequest`

`server/models/canvas.py` — 从 L1485-L1511, L1598-L1660 提取 `CanvasVideoRequest`, `CanvasLLMRequest`, `CanvasCreateRequest`, `CanvasSaveRequest`, `CanvasAssetCheckRequest`, `CanvasAssetDownloadRequest`, `SmartCanvasGroupExportItem`, `SmartCanvasGroupExportRequest`, `LocalImageImportRequest`, `AssetLibraryCategoryRequest`, `AssetLibraryAddRequest`, `AssetLibraryRenameRequest`

`server/models/workflow.py` — 从 L6229-L6252 提取 `WorkflowField`, `WorkflowConfig`, `WorkflowUploadRequest`, `WorkflowRunRequest`

`server/models/provider.py` — 从 L1537-L1559, L4371 提取 `RunningHubWorkflowConfigField`, `RunningHubWorkflowConfig`, `ApiProviderPayload`, `TestConnectionPayload`, 以及 L1510-L1523 的 `RunningHubSubmitRequest`, `RunningHubWorkflowSubmitRequest`, `RunningHubUploadAssetRequest`

- [ ] **Step 3: 修改 main.py 的 import**

```python
from server.models.generation import (
    GenerateRequest, CloudGenRequest, CloudPollRequest,
    OnlineImageRequest, AIReference, CanvasVideoRequest,
    TempShUploadRequest, CloudVideoUploadRequest,
)
from server.models.chat import ChatRequest, ConversationCreateRequest, TokenRequest
from server.models.canvas import (
    CanvasLLMRequest, CanvasCreateRequest, CanvasSaveRequest,
    CanvasAssetCheckRequest, CanvasAssetDownloadRequest,
    SmartCanvasGroupExportRequest, SmartCanvasGroupExportItem,
    LocalImageImportRequest, AssetLibraryCategoryRequest,
    AssetLibraryAddRequest, AssetLibraryRenameRequest,
)
from server.models.workflow import WorkflowField, WorkflowConfig, WorkflowUploadRequest, WorkflowRunRequest
from server.models.provider import (
    ApiProviderPayload, TestConnectionPayload,
    RunningHubSubmitRequest, RunningHubWorkflowSubmitRequest,
    RunningHubUploadAssetRequest,
)
```

从 main.py 中删除这些 class 定义块。

- [ ] **Step 4: 验证**

```bash
python main.py
# 预期: 正常启动，无 import 错误
curl http://127.0.0.1:3000/api/history
```

- [ ] **Step 5: 提交**

```bash
git add server/models/ main.py
git commit -m "refactor(models): extract Pydantic models from main.py"
```

---

### Task 4: 创建 Provider 适配器

**Files:**
- Create: `server/providers/__init__.py`
- Create: `server/providers/base.py`
- Create: `server/providers/openai.py`
- Create: `server/providers/apimart.py`
- Create: `server/providers/volcengine.py`
- Create: `server/providers/modelscope.py`
- Create: `server/providers/runninghub.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/providers/base.py`**

```python
# server/providers/base.py
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

_PROVIDER_REGISTRY: Dict[str, type] = {}

def register_provider(protocol: str):
    """装饰器：自动注册 Provider 类"""
    def decorator(cls):
        _PROVIDER_REGISTRY[protocol] = cls
        return cls
    return decorator

def get_provider_class(protocol: str):
    return _PROVIDER_REGISTRY.get(protocol)

class BaseProvider(ABC):
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.base_url = str(config.get("base_url", "")).rstrip("/")
        self.api_key = str(config.get("api_key", ""))

    @abstractmethod
    async def generate_image(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """返回 {image_data: bytes, raw: dict} 或 {task_id: str, raw: dict}"""

    def get_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
```

- [ ] **Step 2: 创建 `server/providers/volcengine.py`**

从 main.py 提取所有 `volcengine_*` 函数（L2588-L2629）：`volcengine_media_reference_url`, `volcengine_content_role`, `volcengine_video_duration`, `volcengine_video_resolution`, `is_volcengine_seedance2_model`，加上 L3253-3257 的 `is_volcengine_seedream_model`, `normalize_volcengine_size`。

```python
# server/providers/volcengine.py
import re
from .base import BaseProvider, register_provider


@register_provider("volcengine")
class VolcengineProvider(BaseProvider):
    async def generate_image(self, params):
        pass  # Phase 1.3 实现

# --- 火山引擎工具函数 ---
def volcengine_media_reference_url(value, max_image_size=1536):
    """从 main.py L2588 原样复制"""
    pass

def volcengine_content_role(role: str, kind: str = "image") -> str:
    pass

def volcengine_video_duration(duration) -> int:
    pass

def volcengine_video_resolution(value: str) -> str:
    pass

def is_volcengine_seedance2_model(model: str) -> bool:
    pass

def is_volcengine_seedream_model(model):
    pass

def normalize_volcengine_size(size, model=""):
    pass

def volcengine_endpoint_url(provider):
    pass

def volcengine_image_payload(ref):
    pass
```

- [ ] **Step 3: 创建 `server/providers/apimart.py`**

从 main.py 提取 L2733-L2937 区域的 APIMart 相关函数：
`valid_apimart_video_image_input`, `normalize_apimart_video_reference`, `apimart_video_reference_error`, `apimart_video_duration`, `apimart_veo31_duration`, `is_apimart_veo31_model`, `apimart_veo31_model`, `apimart_veo31_aspect`, `apimart_veo31_resolution`, `apimart_upload_file_payload`, `extract_apimart_asset_url`, `apimart_upload_payload_from_bytes`, `apimart_upload_raw_file_payload`

- [ ] **Step 4: 创建 `server/providers/modelscope.py`**

提取 L2136-L2142 (`modelscope_size`), L2713-L2721 (`modelscope_image_url`)

- [ ] **Step 5: 创建 `server/providers/runninghub.py`**

提取 L3499-L3727 区域的 RunningHub 函数

- [ ] **Step 6: 修改 main.py import**

```python
from server.providers.volcengine import (
    volcengine_media_reference_url, volcengine_content_role,
    volcengine_video_duration, volcengine_video_resolution,
    is_volcengine_seedance2_model, is_volcengine_seedream_model,
    normalize_volcengine_size, volcengine_endpoint_url, volcengine_image_payload,
)
from server.providers.apimart import (
    valid_apimart_video_image_input, normalize_apimart_video_reference,
    apimart_video_reference_error, apimart_video_duration, apimart_veo31_duration,
    is_apimart_veo31_model, apimart_veo31_model, apimart_veo31_aspect,
    apimart_veo31_resolution, apimart_upload_file_payload, extract_apimart_asset_url,
)
from server.providers.modelscope import modelscope_size, modelscope_image_url
# ... RunningHub imports
# ... 删除 main.py 中对这些函数的定义
```

- [ ] **Step 7: 验证**

```bash
python main.py
# 预期: 正常启动
# 测试火山引擎视频生成接口
```

- [ ] **Step 8: 提交**

```bash
git add server/providers/ main.py
git commit -m "refactor(providers): extract AI provider adapters from main.py"
```

---

### Task 5: 创建 Services 层

**Files:**
- Create: `server/services/__init__.py`
- Create: `server/services/media_service.py`
- Create: `server/services/image_service.py`
- Create: `server/services/chat_service.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/services/media_service.py`**

提取媒体处理函数，它们不依赖 FastAPI：

从 main.py 提取：
- L2496-L2524: `is_image_reference_value`, `is_video_reference_value`
- L2524-L2552: `convert_output_to_jpg`
- L2552-L2684: `reference_to_data_url`, `media_reference_to_url`, `video_reference_to_frame_data_urls`
- L2684-L2713: `compress_data_url_image`
- L2853-L2859: `invalid_video_image_preview`
- L3022-L3042: `local_media_path_for_cloud_upload`, `local_video_path_for_cloud_upload`
- L2810-L2825: `apimart_veo31_aspect`, `apimart_veo31_resolution` (APIMart 媒体参数)
- L2296-L2343: `output_storage`, `output_url_for`, `output_path_for`, `output_file_from_url`
- L2454-L2460: `content_type_for_path`
- L2755-L2772: `local_asset_public_url`

```python
# server/services/media_service.py
import os
import re
import base64
import shutil
import subprocess
import tempfile
import asyncio
import urllib.parse
import httpx
from server.config import ASSETS_DIR, OUTPUT_DIR


def output_storage(category="output"):
    """从 main.py L2296 原样复制"""
    pass

def output_url_for(filename, category="output"):
    pass

def output_path_for(filename, category="output"):
    pass

def output_file_from_url(url):
    pass

def content_type_for_path(path):
    pass

def reference_to_data_url(ref, max_size=None):
    pass

def media_reference_to_url(value, max_image_size=None):
    pass

def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    pass

def is_image_reference_value(value):
    pass

def is_video_reference_value(value):
    pass

def convert_output_to_jpg(url, quality=88):
    pass

async def video_reference_to_frame_data_urls(value, max_frames=6, max_size=768):
    pass

def local_media_path_for_cloud_upload(ref_url, allowed_prefixes=("image/", "video/")):
    pass

def local_video_path_for_cloud_upload(ref_url):
    return local_media_path_for_cloud_upload(ref_url, ("video/",))
```

- [ ] **Step 2: 创建 `server/services/image_service.py`**

提取核心生图逻辑：
- `generate_ai_image()` (L3783-L3830)
- `extract_image()`, `extract_task_id()` (L2184-L2242)
- `images_api_unsupported()` (L2244-L2250)
- `friendly_image_error_detail()` (L3291-L3314)
- `parse_size_pair()`, `is_gpt_image_2_model()`, `normalize_gpt_image_2_size()`, `apimart_size_resolution()` (L3172-L3260)

```python
# server/services/image_service.py
import time
import httpx
from fastapi import HTTPException
from server.providers.base import get_provider_class


async def generate_ai_image(prompt: str, size: str, quality: str,
                             model: str, refs: list, provider_id: str):
    """从 main.py L3783 原样提取并重构为接收依赖注入"""
    # 原逻辑在此
    pass

# 其他工具函数从 main.py 对应行原样复制
```

- [ ] **Step 3: 创建 `server/services/chat_service.py`**

提取对话逻辑（main.py L5399-L5488 的 chat 函数核心逻辑，去掉 FastAPI 依赖）：

```python
# server/services/chat_service.py
from server.providers.base import get_provider_class


def resolve_chat_provider(provider: str, model: str, ms_model: str):
    """从 main.py L2061 原样复制"""
    pass

def api_headers(json_body=True, provider=None):
    """从 main.py L2085 原样复制"""
    pass

# ... 其他对话相关工具函数
```

- [ ] **Step 4: 修改 main.py**

```python
from server.services.media_service import (
    output_storage, output_url_for, output_path_for, output_file_from_url,
    reference_to_data_url, media_reference_to_url, compress_data_url_image,
    is_image_reference_value, is_video_reference_value,
    video_reference_to_frame_data_urls,
    local_media_path_for_cloud_upload, local_video_path_for_cloud_upload,
    content_type_for_path, convert_output_to_jpg,
)
from server.services.image_service import generate_ai_image
# ... 删除 main.py 中的原函数定义
```

- [ ] **Step 5: 验证所有 API 正常运行**

```bash
python main.py
# 测试生图、媒体上传、历史记录
```

- [ ] **Step 6: 提交**

```bash
git add server/services/ main.py
git commit -m "refactor(services): extract media and image services from main.py"
```

---

### Task 6: 创建 WebSocket Manager 模块

**Files:**
- Create: `server/ws/__init__.py`
- Create: `server/ws/manager.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/ws/manager.py`**

从 main.py L68-L168 复制完整的 `ConnectionManager` 类和 `manager = ConnectionManager()` 实例。

```python
# server/ws/manager.py
import json
from typing import Dict, List
from fastapi import WebSocket


class ConnectionManager:
    # 从 main.py L68-L140 原样复制
    pass

manager = ConnectionManager()
```

- [ ] **Step 2: 修改 main.py**

```python
from server.ws.manager import manager
# 删除 main.py 中 ConnectionManager 类定义和 manager 实例化
```

- [ ] **Step 3: 验证 WebSocket 连接正常**

```bash
python main.py
# 打开浏览器 http://127.0.0.1:3000/，检查 WS 连接
```

- [ ] **Step 4: 提交**

```bash
git add server/ws/ main.py
git commit -m "refactor(ws): extract WebSocket manager from main.py"
```

---

### Task 7: 创建 Route 层

**Files:**
- Create: `server/routes/__init__.py`
- Create: `server/routes/generation.py`
- Create: `server/routes/chat.py`
- Create: `server/routes/canvas.py`
- Create: `server/routes/workflow.py`
- Create: `server/routes/provider.py`
- Create: `server/routes/update.py`
- Modify: `main.py`

- [ ] **Step 1: 创建 `server/routes/generation.py`**

从 main.py 提取 L3978-L4005 (`/`, `/api/view`, `/api/download-output`, `/api/upload`, `/api/ai/upload`), L4596-L5033 (`/api/online-image`, `/api/canvas-image-tasks`), L5033-L5498 (`/api/canvas-video`), L5827-L6221 (`/generate`, `/api/ms/generate`, `/api/generate`)

使用 FastAPI `APIRouter`:

```python
# server/routes/generation.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from server.models.generation import (
    OnlineImageRequest, CanvasVideoRequest, GenerateRequest, CloudGenRequest
)
from server.services.image_service import generate_ai_image
from server.ws.manager import manager

router = APIRouter()

@router.get("/")
async def index():
    from server.config import static_html_response
    return static_html_response("index.html")

@router.post("/api/online-image")
async def online_image(req: OnlineImageRequest):
    # 从 main.py L4596 原样复制路由函数
    pass

@router.post("/api/canvas-video")
async def canvas_video(payload: CanvasVideoRequest):
    # 从 main.py L5033 原样复制路由函数
    pass

# ... 其他生图路由
```

- [ ] **Step 2: 创建其他 route 文件**

`server/routes/chat.py` — 提取 L5399-L5582 (`/api/chat`, `/api/chat/stream`), L5102-L5127 (`/api/conversations*`)

`server/routes/canvas.py` — 提取 L5127-L5396 画布 CRUD, L5216-L5264 Smart Canvas 导出

`server/routes/workflow.py` — 提取 L6596-L6734 ComfyUI 工作流管理

`server/routes/provider.py` — 提取 L4202-L4596 RunningHub 路由 + L4280-L4550 API Provider 路由

`server/routes/update.py` — 提取 L1059-L1435 自动更新 + 回滚路由

- [ ] **Step 3: 重构 main.py 为入口文件**

```python
# main.py (精简后)
import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from server.config import STATIC_DIR, sync_static_html_versions
from server.routes.generation import router as gen_router
from server.routes.chat import router as chat_router
from server.routes.canvas import router as canvas_router
from server.routes.workflow import router as workflow_router
from server.routes.provider import router as provider_router
from server.routes.update import router as update_router
from server.ws.manager import manager

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(gen_router)
app.include_router(chat_router)
app.include_router(canvas_router)
app.include_router(workflow_router)
app.include_router(provider_router)
app.include_router(update_router)

# WebSocket
@app.websocket("/ws/stats")
async def ws_endpoint(websocket, client_id: str = None):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except:
        await manager.disconnect(websocket, client_id)

# 静态文件
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.on_event("startup")
async def startup():
    sync_static_html_versions()
```

- [ ] **Step 4: 验证全量 API**

```bash
python main.py
# 逐一测试:
# GET /api/history
# POST /api/online-image
# GET /api/canvases
# POST /api/chat
# GET /api/workflows
```

- [ ] **Step 5: 提交**

```bash
git add server/routes/ main.py
git commit -m "refactor(routes): split routes from main.py into thin route modules"
```

---

### Task 8: 生成 upstream-map.json 映射表

**Files:**
- Create: `upstream-map.json`

- [ ] **Step 1: 扫描 main.py 中的所有顶层函数和类，生成映射**

```bash
grep -n "^(def |class )" main.py | grep -v "^#" > /tmp/functions.txt
# 逐个确认每个符号归属到哪个新文件
```

- [ ] **Step 2: 创建 `upstream-map.json`**

```json
{
  "version": "d86663c",
  "generated": "2026-05-28",
  "mappings": {
    "QuietAccessLogFilter": "server/config.py",
    "ConnectionManager": "server/ws/manager.py",
    "ensure_runtime_config_files": "server/config.py",
    "load_env_file": "server/config.py",
    "model_list": "server/config.py",
    "reload_env_globals": "server/config.py",
    "provider_key_env": "server/routes/provider.py",
    "runninghub_wallet_key_env": "server/routes/provider.py",
    "mask_secret": "server/config.py",
    "strip_auth_scheme": "server/config.py",
    "bearer_auth_value": "server/config.py",
    "default_api_providers": "server/services/provider_service.py",
    "merge_default_api_providers": "server/services/provider_service.py",
    "normalize_model_list": "server/services/provider_service.py",
    "model_list_from_values": "server/services/provider_service.py",
    "normalize_ms_loras": "server/services/provider_service.py",
    "normalize_runninghub_entry": "server/routes/provider.py",
    "public_provider": "server/services/provider_service.py",
    "get_api_provider": "server/services/provider_service.py",
    "env_quote": "server/config.py",
    "update_env_values": "server/config.py",
    "current_app_version": "server/config.py",
    "versioned_static_html": "server/config.py",
    "sync_static_html_versions": "server/config.py",
    "static_html_response": "server/config.py",
    "update_allowed_file": "server/routes/update.py",
    "generate_cloud": "server/routes/generation.py",
    "generate_ai_image": "server/services/image_service.py",
    "canvas_video": "server/routes/generation.py",
    "canvas_llm": "server/routes/canvas.py",
    "chat": "server/routes/chat.py",
    "volcengine_media_reference_url": "server/providers/volcengine.py",
    "volcengine_content_role": "server/providers/volcengine.py",
    "volcengine_video_duration": "server/providers/volcengine.py",
    "volcengine_video_resolution": "server/providers/volcengine.py",
    "is_volcengine_seedance2_model": "server/providers/volcengine.py",
    "is_volcengine_seedream_model": "server/providers/volcengine.py",
    "normalize_volcengine_size": "server/providers/volcengine.py",
    "apimart_video_duration": "server/providers/apimart.py",
    "apimart_veo31_duration": "server/providers/apimart.py",
    "is_apimart_veo31_model": "server/providers/apimart.py",
    "video_reference_to_frame_data_urls": "server/services/media_service.py",
    "local_media_path_for_cloud_upload": "server/services/media_service.py",
    "output_storage": "server/services/media_service.py",
    "output_url_for": "server/services/media_service.py",
    "output_path_for": "server/services/media_service.py",
    "reference_to_data_url": "server/services/media_service.py",
    "media_reference_to_url": "server/services/media_service.py",
    "is_image_reference_value": "server/services/media_service.py",
    "is_video_reference_value": "server/services/media_service.py",
    "compress_data_url_image": "server/services/media_service.py",
    "convert_output_to_jpg": "server/services/media_service.py",
    "save_to_history": "server/data/history_store.py",
    "modelscope_size": "server/providers/modelscope.py"
  }
}
```

> 完整映射表约 120 条，此处列出关键条目。实际文件需包含 main.py 中所有顶层函数和类。

- [ ] **Step 3: 验证**

```bash
# 确认映射表中的路径都存在
python -c "import json; d=json.load(open('upstream-map.json')); \
  [print(v) for v in set(d['mappings'].values()) if not __import__('os').path.exists(v)]"
# 预期: 无输出（所有路径都存在）
```

- [ ] **Step 4: 提交**

```bash
git add upstream-map.json
git commit -m "docs: add upstream function-to-module mapping table"
```

---

### Task 9: 前端基础设施 — Vite + Vue 3 + TypeScript 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/shared/api-client.ts`
- Create: `src/shared/ws-client.ts`
- Create: `src/shared/i18n/engine.ts`
- Create: `src/shared/types/api.ts`

- [ ] **Step 1: 创建 `package.json`**

```bash
npm init -y
npm install vue@3 vue-router@4 pinia
npm install -D typescript vite @vitejs/plugin-vue vue-tsc
```

检查是否已有 Node.js 环境，如果没有，需要先安装：https://nodejs.org/

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: 创建 `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  build: {
    outDir: 'static/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'api-settings': resolve(__dirname, 'src/pages/api-settings/index.html'),
        'comfyui-settings': resolve(__dirname, 'src/pages/comfyui-settings/index.html'),
        // 后续迁移页面时逐步添加
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true }
    }
  }
})
```

- [ ] **Step 4: 创建 `src/shared/api-client.ts`**

```typescript
// src/shared/api-client.ts — 框架无关的 HTTP 客户端

const BASE = ''

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts
  const init: RequestInit = { method, headers, signal }
  if (body != null) {
    init.body = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, detail.detail || res.statusText)
  }
  return res.json()
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal })
}

export async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body, signal })
}

export async function uploadFile(path: string, file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('files', file)
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function streamSSE(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) onChunk(delta)
        } catch { /* skip malformed */ }
      }
    }
  }
}
```

- [ ] **Step 5: 创建 `src/shared/ws-client.ts`**

```typescript
// src/shared/ws-client.ts — WebSocket 单例

type MessageHandler = (msg: Record<string, unknown>) => void

class WsClient {
  private ws: WebSocket | null = null
  private handlers: Map<string, Set<MessageHandler>> = new Map()
  private _connected = false

  get connected(): boolean { return this._connected }

  connect(clientId?: string): void {
    if (this.ws) return
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws/stats${clientId ? `?client_id=${clientId}` : ''}`
    this.ws = new WebSocket(url)
    this.ws.onopen = () => { this._connected = true }
    this.ws.onclose = () => { this._connected = false; this.ws = null }
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const type = msg.type || ''
        this.handlers.get(type)?.forEach(h => h(msg))
        this.handlers.get('*')?.forEach(h => h(msg))
      } catch { /* ignore */ }
    }
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping')
    }, 30000)
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this._connected = false
  }
}

export const wsClient = new WsClient()
```

- [ ] **Step 6: 创建 `src/shared/i18n/engine.ts`**

将 `static/js/i18n-core.js` 翻译为 TypeScript：

```typescript
// src/shared/i18n/engine.ts

type LangPack = Record<string, string>
type LangBundle = Record<string, { zh: string; en: string } | string>

const KEY = 'studio_lang'
const DEFAULT_LANG = 'zh'
const dict: Record<string, LangPack> = { zh: {}, en: {} }

export function lang(): string {
  return localStorage.getItem(KEY) || DEFAULT_LANG
}

export function register(bundle: LangBundle): void {
  for (const [key, entry] of Object.entries(bundle)) {
    if (typeof entry === 'object' && entry !== null && ('zh' in entry || 'en' in entry)) {
      dict.zh[key] = String((entry as { zh: string }).zh ?? (entry as { en: string }).en ?? key)
      dict.en[key] = String((entry as { en: string }).en ?? (entry as { zh: string }).zh ?? key)
    } else {
      const value = String(entry)
      dict.zh[key] = value
      dict.en[key] = value
    }
  }
}

export function t(key: string): string {
  return dict[lang()]?.[key] || dict[DEFAULT_LANG]?.[key] || key
}

export function setLang(next: string): void {
  localStorage.setItem(KEY, next === 'en' ? 'en' : 'zh')
  applyLang()
}

export function toggleLang(): void {
  setLang(lang() === 'en' ? 'zh' : 'en')
}

export function applyLang(root: Element = document.body): void {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n')!)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')!))
  })
  document.documentElement.setAttribute('lang', lang() === 'en' ? 'en' : 'zh-CN')
}
```

- [ ] **Step 7: 创建 `src/shared/types/api.ts`**

```typescript
// src/shared/types/api.ts — 前端 API 类型契约

export interface OnlineImageParams {
  prompt: string
  provider_id: string
  model: string
  size: string
  quality: string
  n: number
  reference_images: AIReference[]
}

export interface AIReference {
  url: string
  name: string
  role: string
}

export interface VideoGenParams {
  prompt: string
  provider_id: string
  model: string
  duration: number
  aspect_ratio: string
  images: AIReference[]
  videos: string[]
}

export interface ChatParams {
  message: string
  provider: string
  model: string
  mode: 'chat' | 'image'
  conversation_id?: string
  reference_images: AIReference[]
  size: string
  quality: string
}

export interface CanvasNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  title: string
  [key: string]: unknown
}

export interface CanvasConnection {
  from: string
  to: string
  fromPort: string
  toPort: string
}

export interface CanvasData {
  id: string
  title: string
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  viewport: { x: number; y: number; zoom: number }
  updated_at: number
  deleted_at?: number
}
```

- [ ] **Step 8: 验证**

```bash
npx tsc --noEmit
# 预期: 零 TypeScript 错误
npm run build
# 预期: Vite 构建成功
```

- [ ] **Step 9: 提交**

```bash
git add package.json tsconfig.json vite.config.ts src/shared/ .gitignore
# 更新 .gitignore 添加 node_modules/ 和 static/dist/
git commit -m "feat(frontend): init Vue 3 + TypeScript + Vite project with shared modules"
```

---

### Task 10: 迁移 api-settings 页面

**Files:**
- Create: `src/pages/api-settings/index.html`
- Create: `src/pages/api-settings/main.ts`
- Create: `src/pages/api-settings/App.vue`
- Create: `src/components/ProviderForm.vue`

- [ ] **Step 1: 创建 Vite 入口 HTML**

```html
<!-- src/pages/api-settings/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Settings</title>
  <link rel="stylesheet" href="/static/css/theme.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 `src/pages/api-settings/main.ts`**

```typescript
import { createApp } from 'vue'
import App from './App.vue'
import { register } from '@/shared/i18n/engine'
import apiSettingsI18n from '@/shared/i18n/api-settings'
import { wsClient } from '@/shared/ws-client'

register(apiSettingsI18n)
wsClient.connect()

createApp(App).mount('#app')
```

- [ ] **Step 3: 创建 `src/pages/api-settings/App.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { get, post } from '@/shared/api-client'
import { t } from '@/shared/i18n/engine'
import ProviderForm from '@/components/ProviderForm.vue'

interface Provider {
  id: string
  name: string
  base_url: string
  protocol: string
  enabled: boolean
  primary: boolean
  api_key: string
  image_models: string[]
  chat_models: string[]
}

const providers = ref<Provider[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    providers.value = await get<Provider[]>('/api/providers')
  } catch (e) {
    console.error('Failed to load providers', e)
  } finally {
    loading.value = false
  }
})

async function saveProvider(provider: Provider) {
  await post('/api/providers', provider)
}
</script>

<template>
  <div class="api-settings-page">
    <header>
      <h1>{{ t('api.title') }}</h1>
    </header>
    <main>
      <div v-if="loading">{{ t('common.loading') }}</div>
      <ProviderForm
        v-for="p in providers"
        :key="p.id"
        :provider="p"
        @save="saveProvider"
      />
    </main>
  </div>
</template>
```

- [ ] **Step 4: 更新 `vite.config.ts` 和路由**

在 FastAPI main.py 中添加路由：

```python
# 在 app.mount("/static"...) 之后
@app.get("/api-settings")
async def api_settings_page():
    return FileResponse("static/dist/pages/api-settings/index.html")
```

旧 `static/api-settings.html` 保留不动。

- [ ] **Step 5: 验证页面功能**

```bash
npm run build
python main.py
# 访问 http://127.0.0.1:3000/api-settings
# 验证: API 提供商列表加载, 编辑/保存功能正常
```

- [ ] **Step 6: 提交**

```bash
git add src/pages/api-settings/ src/components/ vite.config.ts main.py
git commit -m "feat(api-settings): migrate to Vue 3 + TypeScript"
```

---

后续 Task 11-17 遵循相同模式：

- **Task 11**: 迁移 comfyui-settings 页面
- **Task 12**: 迁移简单生图页面（online / zimage / klein / enhance）
- **Task 13**: 迁移 gpt-chat 页面
- **Task 14**: 迁移 angle 页面（LTX 时间线）
- **Task 15**: 创建 canvas-app SPA 骨架（router + stores + CanvasViewport）
- **Task 16**: 迁移画布节点组件（逐个节点类型）
- **Task 17**: Phase 3 质量加固（openapi-typescript + pytest + ESLint + pre-commit）

---

### 验证清单

- [ ] `main.py` 从 6957 行缩减到 < 150 行
- [ ] 每个 server/ 模块 ≤ 300 行
- [ ] 所有现有 API 端点无回归
- [ ] TypeScript 编译零错误 (`npx tsc --noEmit`)
- [ ] Vite build 成功 (`npm run build`)
- [ ] upstream-map.json 覆盖主文件中所有顶层符号
- [ ] 新旧页面共存（旧 HTML 仍在 static/，新页面在 static/dist/）
