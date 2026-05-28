import json
import os
import re
from typing import List

import httpx
from fastapi import APIRouter, HTTPException

from server.config import (
    AI_BASE_URL, CHAT_MODEL, CHAT_MODELS, COMFYUI_INSTANCES,
    GLOBAL_CONFIG_FILE, IMAGE_MODEL, IMAGE_MODELS,
    MODELSCOPE_API_KEY, MODELSCOPE_CHAT_MODELS, VIDEO_MODELS,
    reload_env_globals, update_env_values,
)
from server.models import ApiProviderPayload, TestConnectionPayload
from server.services.provider_service import (
    bearer_auth_value,
    get_api_provider_exact,
    load_api_providers,
    normalize_provider,
    preserve_runninghub_hidden_overrides,
    provider_key_env,
    provider_protocol,
    protocol_from_payload,
    public_provider,
    runninghub_wallet_key_env,
    save_api_providers,
    upstream_model_headers,
    upstream_models_url,
    parse_upstream_models,
    fetch_models_from_upstream,
)

router = APIRouter()


@router.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    providers = [public_provider(p) for p in load_api_providers()]
    return {
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "video_models": VIDEO_MODELS,
        "comfy_instances": COMFYUI_INSTANCES,
        "api_providers": providers,
        "has_api_key": bool(os.getenv("COMFLY_API_KEY", "")),
        "ms_chat_models": MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(MODELSCOPE_API_KEY),
    }


@router.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS, "video_models": VIDEO_MODELS}


@router.get("/api/providers")
async def api_providers():
    return {"providers": [public_provider(p) for p in load_api_providers()]}


@router.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    providers = []
    env_updates = {}
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    for item in payload:
        provider = normalize_provider(item.dict(exclude={"api_key"}))
        if provider["id"] == "runninghub":
            provider = preserve_runninghub_hidden_overrides(provider)
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复：{provider['id']}")
        providers.append(provider)
        key_env = provider_key_env(provider["id"])
        if item.clear_key:
            env_updates[key_env] = ""
        elif item.api_key is not None and item.api_key.strip():
            env_updates[key_env] = item.api_key.strip()
        if provider["id"] == "runninghub":
            wallet_env = runninghub_wallet_key_env()
            if item.clear_wallet_key:
                env_updates[wallet_env] = ""
            elif item.wallet_api_key is not None and item.wallet_api_key.strip():
                env_updates[wallet_env] = item.wallet_api_key.strip()
        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
            env_updates["IMAGE_MODELS"] = ",".join(provider["image_models"])
            env_updates["CHAT_MODELS"] = ",".join(provider["chat_models"])
            env_updates["VIDEO_MODELS"] = ",".join(provider.get("video_models") or [])
        if provider["id"] == "modelscope":
            env_updates["MODELSCOPE_CHAT_MODELS"] = ",".join(provider["chat_models"])
        if provider["id"] == "runninghub":
            provider["protocol"] = "runninghub"
    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)
    save_api_providers(providers)
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()
    return {"providers": [public_provider(p) for p in providers]}


@router.get("/api/config/token")
async def get_global_token():
    if MODELSCOPE_API_KEY:
        return {"token": MODELSCOPE_API_KEY}
    if os.path.exists(GLOBAL_CONFIG_FILE):
        try:
            with open(GLOBAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return {"token": config.get("modelscope_token", "")}
        except Exception:
            pass
    return {"token": ""}


@router.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = (payload.api_key or "").strip()
    if not api_key and payload.provider_id:
        api_key = os.getenv(runninghub_wallet_key_env(), "") if payload.provider_id == "runninghub" else ""
        if not api_key:
            api_key = os.getenv(provider_key_env(payload.provider_id), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    protocol = protocol_from_payload(payload)
    url = upstream_models_url(base_url, protocol)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=upstream_model_headers(api_key, protocol))
        if resp.status_code >= 400:
            return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}
        data = resp.json() if resp.text else {}
        grouped, ids = parse_upstream_models(data, protocol)
        return {"ok": True, "status": resp.status_code, "model_count": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}
    except httpx.HTTPError as e:
        return {"ok": False, "status": 0, "message": str(e)[:300]}


@router.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    api_key = (payload.api_key or "").strip()
    if not api_key and payload.provider_id:
        api_key = os.getenv(runninghub_wallet_key_env(), "") if payload.provider_id == "runninghub" else ""
        if not api_key:
            api_key = os.getenv(provider_key_env(payload.provider_id), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={"Authorization": bearer_auth_value(api_key), "Accept": "application/json"})
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]
        sc = resp.status_code
        err_msg = ""
        if isinstance(body, dict):
            err = body.get("error") or {}
            if isinstance(err, dict):
                err_msg = str(err.get("message") or "").lower()
            else:
                err_msg = str(err).lower()
        if sc == 400 and "invalid task id" in err_msg:
            return {"ok": True, "status_code": sc, "message": "异步任务端点可用，API Key 已通过认证", "raw": body}
        if sc in (401, 403):
            return {"ok": False, "status_code": sc, "message": "API Key 无效或无权限", "raw": body}
        if sc == 404:
            return {"ok": False, "status_code": sc, "message": "平台不支持 /v1/tasks/ 端点，可能不是 APIMart 异步协议", "raw": body}
        if 400 <= sc < 500:
            return {"ok": None, "status_code": sc, "message": f"端点返回 {sc}，请查看原始响应判断", "raw": body}
        if sc < 300:
            return {"ok": True, "status_code": sc, "message": f"端点返回 {sc}（意外成功）", "raw": body}
        return {"ok": False, "status_code": sc, "message": f"服务端错误 {sc}", "raw": body}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])


@router.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    api_key = (payload.api_key or "").strip()
    if not api_key and payload.provider_id:
        api_key = os.getenv(runninghub_wallet_key_env(), "") if payload.provider_id == "runninghub" else ""
        if not api_key:
            api_key = os.getenv(provider_key_env(payload.provider_id), "")
    return await fetch_models_from_upstream(payload.base_url, api_key, protocol_from_payload(payload))


@router.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    provider = get_api_provider_exact(provider_id)
    api_key = os.getenv(runninghub_wallet_key_env(), "") if provider["id"] == "runninghub" else ""
    if not api_key:
        api_key = os.getenv(provider_key_env(provider["id"]), "")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key, provider_protocol(provider))
