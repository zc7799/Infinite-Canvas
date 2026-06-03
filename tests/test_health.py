import asyncio
import os
import unittest

os.environ["INFINITE_CANVAS_SKIP_RUNTIME_INIT"] = "1"

import main
import upload_utils
from fastapi import HTTPException


class AsyncBytesFile:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.offset = 0

    async def read(self, size: int = -1) -> bytes:
        if self.offset >= len(self.payload):
            return b""
        if size is None or size < 0:
            size = len(self.payload) - self.offset
        end = min(len(self.payload), self.offset + size)
        chunk = self.payload[self.offset:end]
        self.offset = end
        return chunk


class HealthChecks(unittest.TestCase):
    def test_app_imports_with_routes(self):
        self.assertGreaterEqual(len(main.app.routes), 100)

    def test_update_file_allowlist_blocks_traversal(self):
        self.assertTrue(main.update_allowed_file("main.py"))
        self.assertTrue(main.update_allowed_file("static/index.html"))
        self.assertFalse(main.update_allowed_file("../main.py"))
        self.assertFalse(main.update_allowed_file("API/.env"))

    def test_output_file_from_url_blocks_traversal(self):
        self.assertIsNone(main.output_file_from_url("/assets/input/../../main.py"))

    def test_upload_reader_enforces_limit(self):
        async def run_check():
            fake = AsyncBytesFile(b"abcdef")
            with self.assertRaises(HTTPException) as ctx:
                await upload_utils.read_upload_file_limited(fake, 5, "测试文件")
            self.assertEqual(ctx.exception.status_code, 413)

        asyncio.run(run_check())


if __name__ == "__main__":
    unittest.main()
