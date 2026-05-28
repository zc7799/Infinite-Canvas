import json
import os
import time
from typing import Any, Dict, List, Optional

from server.config import DATA_DIR, HISTORY_FILE
from server.data.base_store import JsonStore


class HistoryStore(JsonStore):
    """历史记录存储，支持自动归档"""

    MAX_ENTRIES = 5000
    ARCHIVE_AFTER_DAYS = 30
    ARCHIVE_DIR = os.path.join(DATA_DIR, "history_archive")

    def add(self, record: Dict[str, Any]) -> None:
        with self._lock:
            history = self._read_all()
            if not isinstance(history, list):
                history = []
            if "timestamp" not in record:
                record["timestamp"] = time.time()
            history.insert(0, record)
            if len(history) > self.MAX_ENTRIES:
                history = history[: self.MAX_ENTRIES]
            self._atomic_write(history)

    def list(self, type_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        history = self._read_all()
        if not isinstance(history, list):
            return []
        if type_filter:
            history = [item for item in history if item.get("type", "zimage") == type_filter]
        history = [item for item in history if item.get("images") and len(item["images"]) > 0]
        history.sort(key=lambda item: float(item.get("timestamp", 0)), reverse=True)
        return history

    def delete_by_timestamp(self, timestamp) -> Optional[Dict[str, Any]]:
        with self._lock:
            history = self._read_all()
            if not isinstance(history, list):
                return None
            target = None
            new_history = []
            for item in history:
                item_ts = item.get("timestamp", 0)
                is_match = False
                if isinstance(timestamp, (int, float)) and isinstance(item_ts, (int, float)):
                    if abs(float(item_ts) - float(timestamp)) < 0.001:
                        is_match = True
                elif str(item_ts) == str(timestamp):
                    is_match = True
                if is_match:
                    target = item
                else:
                    new_history.append(item)
            if target:
                self._atomic_write(new_history)
            return target

    def _maybe_archive(self) -> None:
        """将超过 ARCHIVE_AFTER_DAYS 天的记录移到归档文件"""
        history = self._read_all()
        if not isinstance(history, list) or not history:
            return
        cutoff = time.time() - self.ARCHIVE_AFTER_DAYS * 24 * 60 * 60
        active = []
        archive = []
        for item in history:
            ts = item.get("timestamp", 0)
            if isinstance(ts, (int, float)) and float(ts) < cutoff:
                archive.append(item)
            else:
                active.append(item)
        if archive:
            os.makedirs(self.ARCHIVE_DIR, exist_ok=True)
            month_key = time.strftime("%Y-%m", time.localtime(time.time()))
            archive_path = os.path.join(self.ARCHIVE_DIR, f"{month_key}.json")
            existing = []
            if os.path.exists(archive_path):
                try:
                    with open(archive_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (json.JSONDecodeError, IOError):
                    existing = []
            if not isinstance(existing, list):
                existing = []
            existing.extend(archive)
            with open(archive_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            self._atomic_write(active)


history_store = HistoryStore(HISTORY_FILE)
