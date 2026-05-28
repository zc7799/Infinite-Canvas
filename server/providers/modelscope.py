"""ModelScope Provider 工具函数"""

import asyncio
import time

import httpx
from fastapi import HTTPException

from server.config import (
    AI_REQUEST_TIMEOUT,
    IMAGE_POLL_INTERVAL,
    MODELSCOPE_API_KEY,
    MODELSCOPE_CHAT_BASE_URL,
)
from server.providers.apimart import parse_size_pair
from server.services.media_service import extract_image
from server.services.provider_service import selected_model


def modelscope_size(value, fallback="1024x1024"):
    """标准化 ModelScope 图片尺寸"""
    import re
    text = str(value or "").strip().lower()
    if not text or text in {"auto", "auto", "none", "0x0"}:
        return fallback
    m = re.match(r"^(\d+)x(\d+)$", text)
    if m:
        return f"{m.group(1)}x{m.group(2)}"
    aliases = {"2k": "2048x2048", "4k": "4096x4096", "1k": "1024x1024"}
    return aliases.get(text, fallback)


def modelscope_image_url(value, max_size=1536):
    """返回适合 ModelScope 的图片 URL（将本地 data URL 压缩到指定大小）"""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value:
        return ""
    if value.startswith("data:") and ";base64," in value:
        return compress_data_url_image(value, max_size=max_size)
    return value


def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    """压缩 data URL 图片到指定最大边长"""
    import base64
    from io import BytesIO
    from PIL import Image

    if not isinstance(value, str) or not value.startswith("data:image/") or ";base64," not in value:
        return value
    header, encoded = value.split(";base64,", 1)
    try:
        raw = base64.b64decode(encoded)
    except Exception:
        return value
    try:
        img = Image.open(BytesIO(raw))
        w, h = img.size
        if max(w, h) <= max_size:
            return value
        scale = max_size / max(w, h)
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
        new_encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        new_header = header.replace("image/png", "image/jpeg")
        return f"{new_header};base64,{new_encoded}"
    except Exception:
        return value


async def generate_modelscope_provider_image(prompt, size, model, reference_images=None, provider=None):
    clean_token = MODELSCOPE_API_KEY.strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
    width, height = parse_size_pair(size)
    refs = []
    for ref in (reference_images or [])[:4]:
        if not ref.get("url"):
            continue
        refs.append(modelscope_image_url(ref.get("url", ""), max_size=1536))
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
    }
    payload = {
        "model": selected_model(model, "Tongyi-MAI/Z-Image-Turbo"),
        "prompt": prompt.strip(),
    }
    if width and height:
        payload["width"] = width
        payload["height"] = height
        payload["size"] = f"{width}x{height}"
    if refs:
        payload["image_url"] = refs

    base_root = ((provider or {}).get("base_url") or MODELSCOPE_CHAT_BASE_URL).rstrip("/")
    api_root = base_root if base_root.endswith("/v1") else f"{base_root}/v1"
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
        submit_res.raise_for_status()
        raw = submit_res.json()
        task_id = raw.get("task_id")
        if not task_id:
            try:
                return extract_image(raw), raw
            except HTTPException:
                raise HTTPException(status_code=502, detail=f"ModelScope 未返回 task_id：{raw}")

        deadline = time.monotonic() + AI_REQUEST_TIMEOUT
        last_payload = raw
        while time.monotonic() < deadline:
            await asyncio.sleep(IMAGE_POLL_INTERVAL)
            result = await client.get(
                f"{api_root}/tasks/{task_id}",
                headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
            )
            result.raise_for_status()
            data = result.json()
            last_payload = data
            status = str(data.get("task_status") or "").upper()
            if status == "SUCCEED":
                images = data.get("output_images") or []
                if not images:
                    raise HTTPException(status_code=502, detail=f"ModelScope 成功但没有返回图片：{data}")
                return {"type": "url", "value": images[0]}, data
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                detail = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{detail}")
        raise HTTPException(status_code=504, detail=f"ModelScope 生图任务超时：{last_payload}")
