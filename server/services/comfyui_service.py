"""ComfyUI 辅助服务：负载均衡、输出下载、历史记录"""
import json
import os
import re
import shutil
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List

import requests

from server.config import BACKEND_LOCAL_LOAD, COMFYUI_INSTANCES, LOAD_LOCK
from server.data.history_store import history_store
from server.services.media_service import (
    comfy_output_extension,
    output_path_for,
    output_url_for,
    sanitize_export_filename,
)

MEDIA_INPUT_KEYS = ("image", "video", "audio", "mask", "filename", "file")
MEDIA_INPUT_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)", re.I)


def check_images_exist(backend_addr, images):
    if not images:
        return True
    for img in images:
        try:
            url = f"http://{backend_addr}/view?filename={urllib.parse.quote(img)}&type=input"
            r = requests.get(url, stream=True, timeout=0.5)
            r.close()
            if r.status_code != 200:
                return False
        except Exception:
            return False
    return True


def is_comfy_input_media_value(input_name: str, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    key = str(input_name or "").lower()
    if any(token in key for token in MEDIA_INPUT_KEYS):
        return True
    return bool(MEDIA_INPUT_EXT_RE.search(value))


def collect_required_comfy_media(params: Dict[str, Any]) -> List[str]:
    required = []
    for node_inputs in (params or {}).values():
        if not isinstance(node_inputs, dict):
            continue
        for input_name, value in node_inputs.items():
            if is_comfy_input_media_value(input_name, value):
                required.append(value)
    return list(dict.fromkeys(required))


def get_best_backend(required_images: List[str] = None):
    best_backend = COMFYUI_INSTANCES[0]
    min_queue_size = float('inf')
    candidates_with_images = []
    candidates_others = []
    backend_stats = {}

    for addr in COMFYUI_INSTANCES:
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                with LOAD_LOCK:
                    local_load = BACKEND_LOCAL_LOAD.get(addr, 0)
                effective_load = max(remote_load, local_load)
                has_images = check_images_exist(addr, required_images)
                backend_stats[addr] = {"load": effective_load, "has_images": has_images}
                if has_images:
                    candidates_with_images.append(addr)
                else:
                    candidates_others.append(addr)
        except Exception as e:
            print(f"Backend {addr} unreachable: {e}")
            continue

    target_candidates = candidates_with_images if candidates_with_images else candidates_others
    if not target_candidates:
        if candidates_others:
            target_candidates = candidates_others
        else:
            return COMFYUI_INSTANCES[0]

    for addr in target_candidates:
        load = backend_stats[addr]["load"]
        if load < min_queue_size:
            min_queue_size = load
            best_backend = addr

    return best_backend


def download_image(comfy_address, comfy_url_path, prefix="studio_"):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    local_path = output_path_for(filename, "output")
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return output_url_for(filename, "output")
    except Exception as e:
        print(f"下载图片失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def is_video_output_item(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    return ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt


def comfy_output_kind(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"} or "image" in fmt:
        return "image"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt:
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or "audio" in fmt or "sound" in fmt:
        return "audio"
    if ext in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"} or "text" in fmt or "json" in fmt:
        return "text"
    return "file"


def download_comfy_output(comfy_address, item, prefix="studio_"):
    ext = comfy_output_extension(item)
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    local_path = output_path_for(filename, "output")
    subfolder = urllib.parse.quote(str(item.get("subfolder") or ""))
    file_type = urllib.parse.quote(str(item.get("type") or "output"))
    comfy_url_path = f"/view?filename={urllib.parse.quote(str(item['filename']))}&subfolder={subfolder}&type={file_type}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return output_url_for(filename, "output")
    except Exception as e:
        print(f"下载 ComfyUI 输出失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def save_comfy_text_output(value, prefix="studio_", name=""):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    stem = sanitize_export_filename(name or "comfy_text.txt", "comfy_text.txt")
    _, ext = os.path.splitext(stem)
    if ext.lower() not in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"}:
        stem += ".txt"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}_{stem}"
    path = output_path_for(filename, "output")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return output_url_for(filename, "output")


def comfy_text_values_from_output(node_output):
    values = []
    text_keys = ("text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions")
    for key in text_keys:
        if key not in node_output:
            continue
        value = node_output.get(key)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict):
                text = item.get("text") or item.get("prompt") or item.get("caption") or item.get("value")
                name = item.get("filename") or item.get("name") or f"{key}.txt"
            else:
                text = item
                name = f"{key}.txt"
            if text is None:
                continue
            text = str(text)
            if text.strip():
                values.append((text, name))
    return values


def collect_comfy_file_items(node_output):
    items = []
    for key, value in (node_output or {}).items():
        if key in {"text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions"}:
            continue
        candidates = value if isinstance(value, list) else [value]
        for item in candidates:
            if isinstance(item, dict) and item.get("filename"):
                items.append((key, item))
    return items


def save_to_history(record):
    history_store.add(record)


def get_comfy_history(comfy_address, prompt_id):
    try:
        with urllib.request.urlopen(f"http://{comfy_address}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except Exception:
        return {}
