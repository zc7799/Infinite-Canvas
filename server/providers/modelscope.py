"""ModelScope Provider 工具函数"""


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
