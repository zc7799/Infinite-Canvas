"""Gemini Provider 工具函数"""

import urllib.parse

import httpx

from server.services.chat_service import api_headers
from server.services.media_service import extract_image, reference_to_data_url
from server.services.provider_service import provider_endpoint_url


def gemini_model_name(model):
    """返回去掉 'models/' 前缀的模型名"""
    from server.config import IMAGE_MODEL
    # imported locally to avoid circular import; will be resolved in later phases
    selected = model or IMAGE_MODEL
    value = str(selected).strip()
    return value[len("models/"):] if value.startswith("models/") else value


def gemini_image_config(size):
    """返回 Gemini 图片生成的 aspectRatio + imageSize 配置"""
    import re
    from server.providers.apimart import apimart_size_resolution
    width, height = parse_size_pair(size)
    if not width or not height:
        raw = str(size or "").strip().upper()
        if raw in {"1K", "2K", "4K"}:
            return {"aspectRatio": "1:1", "imageSize": raw}
        if re.fullmatch(r"\d+\s*:\s*\d+", raw):
            return {"aspectRatio": raw.replace(" ", ""), "imageSize": "1K"}
        return {"aspectRatio": "1:1", "imageSize": "2K"}
    aspect_ratio, resolution = apimart_size_resolution(size)
    return {"aspectRatio": aspect_ratio, "imageSize": resolution.upper()}


def parse_size_pair(size):
    """解析 'WxH' 格式的尺寸字符串"""
    import re
    raw = str(size or "")
    m = re.match(r"(\d+)\s*[xX×]\s*(\d+)", raw)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def gemini_endpoint_url(provider, model):
    model_name = urllib.parse.quote(gemini_model_name(model), safe="")
    return provider_endpoint_url(provider, "image_generation_endpoint", f"/v1beta/models/{model_name}:generateContent")


def gemini_reference_part(ref):
    value = reference_to_data_url(ref, max_size=1536)
    if not value:
        return None
    if isinstance(value, str) and value.startswith("data:image/") and ";base64," in value:
        header, encoded = value.split(";base64,", 1)
        mime_type = header.replace("data:", "", 1) or "image/png"
        return {"inlineData": {"mimeType": mime_type, "data": encoded}}
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return {"fileData": {"mimeType": "image/png", "fileUri": value}}
    return None


async def generate_gemini_provider_image(prompt, size, model, reference_images=None, provider=None):
    model_name = gemini_model_name(model)
    endpoint = gemini_endpoint_url(provider, model_name)
    parts = [{"text": prompt.strip()}]
    for ref in (reference_images or [])[:16]:
        part = gemini_reference_part(ref)
        if part:
            parts.append(part)
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": gemini_image_config(size),
        },
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=20.0)) as client:
        response = await client.post(endpoint, headers=api_headers(provider=provider), json=body)
        response.raise_for_status()
        raw = response.json()
        return extract_image(raw), raw
