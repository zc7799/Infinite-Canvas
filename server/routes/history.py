import os
from fastapi import APIRouter

from server.data.history_store import history_store
from server.models import DeleteHistoryRequest
from server.services.media_service import output_file_from_url

router = APIRouter()


@router.get("/api/history")
async def get_history_api(type: str = None):
    try:
        return history_store.list(type_filter=type)
    except Exception as e:
        print(f"读取历史文件失败: {e}")
        return []


@router.post("/api/history/delete")
async def delete_history(req: DeleteHistoryRequest):
    try:
        target_record = history_store.delete_by_timestamp(req.timestamp)
        if target_record:
            for img_url in target_record.get("images", []):
                file_path = output_file_from_url(img_url)
                if file_path and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete file {file_path}: {e}")
            return {"success": True}
        else:
            return {"success": False, "message": "Record not found"}
    except Exception as e:
        print(f"Delete history error: {e}")
        return {"success": False, "message": str(e)}
