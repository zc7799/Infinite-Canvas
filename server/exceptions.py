class AppError(Exception):
    """业务异常基类"""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ProviderError(AppError):
    """AI Provider 调用异常"""


class MediaError(AppError):
    """媒体处理异常"""
