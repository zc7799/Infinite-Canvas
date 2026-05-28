from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BaseProvider(ABC):
    """AI 后端适配器基类"""

    @abstractmethod
    async def generate_image(self, params: Dict[str, Any]) -> Dict[str, Any]:
        ...

    @abstractmethod
    async def poll_task(self, task_id: str) -> Dict[str, Any]:
        ...


_PROVIDER_REGISTRY: dict[str, type[BaseProvider]] = {}


def register_provider(protocol: str):
    """装饰器：自动注册 Provider 类"""

    def decorator(cls):
        _PROVIDER_REGISTRY[protocol] = cls
        return cls

    return decorator


def get_provider(protocol: str) -> Optional[type[BaseProvider]]:
    return _PROVIDER_REGISTRY.get(protocol)


def get_provider_registry() -> dict[str, type[BaseProvider]]:
    return dict(_PROVIDER_REGISTRY)
