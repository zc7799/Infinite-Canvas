import json
import os
import threading
from typing import Any, Dict, Optional


class JsonStore:
    """原子写入 + 自动备份的 JSON 文件存储基类"""

    def __init__(self, filepath: str, initial: Optional[Dict[str, Any]] = None):
        self._path = filepath
        self._lock = threading.Lock()
        if initial is None:
            initial = {}
        if not os.path.exists(filepath):
            self._atomic_write(initial)

    def _atomic_write(self, data: dict) -> None:
        tmp = self._path + ".tmp"
        bak = self._path + ".bak"
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        if os.path.exists(self._path):
            try:
                os.replace(self._path, bak)
            except OSError:
                pass
        os.replace(tmp, self._path)

    def _read_all(self) -> dict:
        if not os.path.exists(self._path):
            return {}
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            bak = self._path + ".bak"
            if os.path.exists(bak):
                with open(bak, "r", encoding="utf-8") as f:
                    return json.load(f)
            return {}

    def _write_all(self, data: dict) -> None:
        with self._lock:
            self._atomic_write(data)
