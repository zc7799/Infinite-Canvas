"""Gemini Provider 工具函数"""


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
