import os

from fastapi import HTTPException, UploadFile


UPLOAD_READ_CHUNK_SIZE = int(os.getenv("UPLOAD_READ_CHUNK_SIZE", str(1024 * 1024)))
COMFY_UPLOAD_MAX_BYTES = int(os.getenv("COMFY_UPLOAD_MAX_BYTES", str(512 * 1024 * 1024)))
AI_REFERENCE_UPLOAD_MAX_BYTES = int(os.getenv("AI_REFERENCE_UPLOAD_MAX_BYTES", str(4 * 1024 * 1024 * 1024)))


async def read_upload_file_limited(file: UploadFile, max_bytes: int, label: str = "文件") -> bytes:
    chunks = []
    total = 0
    chunk_size = max(64 * 1024, int(UPLOAD_READ_CHUNK_SIZE or 1024 * 1024))
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail=f"{label}过大，请使用 {max_bytes // (1024 * 1024)}MB 以内的文件")
        chunks.append(chunk)
    return b"".join(chunks)


async def save_upload_file_limited(file: UploadFile, path: str, max_bytes: int, label: str = "文件") -> int:
    total = 0
    chunk_size = max(64 * 1024, int(UPLOAD_READ_CHUNK_SIZE or 1024 * 1024))
    with open(path, "wb") as f:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                f.close()
                try:
                    os.remove(path)
                except OSError:
                    pass
                raise HTTPException(status_code=413, detail=f"{label}过大，请使用 {max_bytes // (1024 * 1024)}MB 以内的文件")
            f.write(chunk)
    return total
