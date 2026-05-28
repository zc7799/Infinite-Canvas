"""文件/上传/查看基础路由"""
import os
import re
import urllib.parse
import uuid

import requests
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response

from server.config import COMFYUI_INSTANCES, STATIC_DIR
from server.models import (
    CloudVideoUploadRequest, LocalImageImportRequest, TempShUploadRequest,
)
from server.services.media_service import (
    content_type_for_path, output_file_from_url, output_path_for, output_url_for,
)
from server.services.update_service import current_app_version
from server.services.video_service import upload_local_video_to_cloud

router = APIRouter()

# --- 本地图片导入辅助函数 ---
LOCAL_IMAGE_MAX_BYTES = 50 * 1024 * 1024
LOCAL_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def normalize_local_image_path(value):
    path = str(value or "").strip()
    if not path:
        return ""
    path = os.path.normpath(path)
    if not os.path.isabs(path):
        path = os.path.abspath(path)
    return path


def import_local_image_file(path):
    path = normalize_local_image_path(path)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"本地图片不存在：{path}")
    ext = os.path.splitext(path)[1].lower()
    if ext not in LOCAL_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的图片格式：{ext}，仅支持 {', '.join(sorted(LOCAL_IMAGE_EXTS))}")
    size = os.path.getsize(path)
    if size > LOCAL_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"本地图片过大（{size} 字节，最大 {LOCAL_IMAGE_MAX_BYTES}）")
    filename = f"import_{uuid.uuid4().hex[:12]}{ext}"
    dest_path = output_path_for(filename, "input")
    try:
        with open(path, "rb") as src:
            with open(dest_path, "wb") as dst:
                dst.write(src.read())
    except OSError:
        raise HTTPException(status_code=500, detail="导入本地图片失败")
    return {"url": output_url_for(filename, "input"), "name": os.path.basename(path) or filename, "kind": "image"}


def ensure_same_origin_request(request: Request):
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if not origin:
        if os.getenv("ENABLE_LOCAL_IMPORT", "").strip().lower() in {"1", "true", "yes"}:
            return
        raise HTTPException(status_code=403, detail="禁止跨域访问，仅允许本地请求")


# --- 路由 ---

def _versioned_static_html(html: str) -> str:
    version = current_app_version()
    if not version:
        return html
    safe_version = urllib.parse.quote(version, safe="._-")
    pattern = re.compile(r'(?P<prefix>(?:src|href)=["\']|@import\s+url\(["\'])(?P<url>/static/[^"\')?#]+(?:\.(?:js|css|html)))(?:\?v=[^"\')#]*)?', re.I)
    return pattern.sub(lambda m: f"{m.group('prefix')}{m.group('url')}?v={safe_version}", html)


def static_html_response(filename: str):
    path = os.path.join(STATIC_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Page not found: {filename}")
    content = open(path, 'r', encoding='utf-8').read()
    return HTMLResponse(content=_versioned_static_html(content))


@router.get("/")
async def index():
    return static_html_response("index.html")


@router.get("/api/view")
def view_image(filename: str, type: str = "input", subfolder: str = ""):
    for addr in COMFYUI_INSTANCES:
        try:
            url = f"http://{addr}/view"
            params = {"filename": filename, "type": type, "subfolder": subfolder}
            r = requests.get(url, params=params, timeout=1)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    if not subfolder and type in ("input", "output"):
        safe_name = os.path.basename(filename or "")
        if safe_name:
            local_path = output_path_for(safe_name, "input" if type == "input" else "output")
            if os.path.isfile(local_path):
                return FileResponse(local_path, media_type=content_type_for_path(local_path))
    raise HTTPException(status_code=404, detail="Image not found on any available backend")


@router.get("/api/download-output")
def download_output(url: str, name: str = ""):
    path = output_file_from_url(url)
    if not path:
        raise HTTPException(status_code=404, detail="文件不存在")
    filename = os.path.basename(name) if name else os.path.basename(path)
    return FileResponse(path, media_type=content_type_for_path(path), filename=filename)


@router.post("/api/upload")
async def upload_image(files: list[UploadFile] = File(...)):
    uploaded_files = []
    files_content = []
    for file in files:
        content = await file.read()
        files_content.append((file, content))

    for file, content in files_content:
        success_count = 0
        last_result = None
        for addr in COMFYUI_INSTANCES:
            try:
                files_data = {'image': (file.filename, content, file.content_type)}
                response = requests.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception as e:
                print(f"Upload error for {addr}: {e}")

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}


@router.post("/api/ai/upload")
async def upload_ai_reference(files: list[UploadFile] = File(...)):
    uploaded = []
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".webm", ".mov", ".m4v"}
    audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
    for file in files:
        content = await file.read()
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        content_type_str = (file.content_type or "").lower()
        kind = "image"
        if ext in video_exts or content_type_str.startswith("video/"):
            kind = "video"
            if ext not in video_exts:
                ext = ".webm" if "webm" in content_type_str else ".mov" if "quicktime" in content_type_str else ".mp4"
        elif ext in audio_exts or content_type_str.startswith("audio/"):
            kind = "audio"
            if ext not in audio_exts:
                ext = ".wav" if "wav" in content_type_str else ".ogg" if "ogg" in content_type_str else ".m4a" if "mp4" in content_type_str else ".mp3"
        elif ext in image_exts or content_type_str.startswith("image/"):
            kind = "image"
            if ext not in image_exts:
                ext = ".jpg" if "jpeg" in content_type_str else ".webp" if "webp" in content_type_str else ".gif" if "gif" in content_type_str else ".png"
        else:
            continue
        filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
        path = output_path_for(filename, "input")
        with open(path, "wb") as f:
            f.write(content)
        uploaded.append({"url": output_url_for(filename, "input"), "name": file.filename or filename, "kind": kind})
    return {"files": uploaded}


@router.post("/api/temp-sh/upload")
async def temp_sh_upload(payload: TempShUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, "auto")


@router.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, payload.service)


@router.post("/api/ai/import-local-image")
async def import_local_ai_reference(payload: LocalImageImportRequest, request: Request):
    ensure_same_origin_request(request)
    requested = [payload.path] if payload.path else []
    requested.extend(payload.paths or [])
    requested = [p for p in requested if str(p or "").strip()][:20]
    if not requested:
        raise HTTPException(status_code=400, detail="没有可导入的本地图片")
    return {"files": [import_local_image_file(normalize_local_image_path(path)) for path in requested]}
