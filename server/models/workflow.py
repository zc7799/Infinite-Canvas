from typing import Any, Dict, List

from pydantic import BaseModel, Field


class WorkflowField(BaseModel):
    key: str = ""
    label: str = ""
    type: str = "text"
    default: Any = ""
    options: List[str] = Field(default_factory=list)
    required: bool = False


class WorkflowConfig(BaseModel):
    fields: List[WorkflowField] = Field(default_factory=list)


class WorkflowUploadRequest(BaseModel):
    name: str = ""
    json_content: Dict[str, Any] = Field(default_factory=dict)


class WorkflowRunRequest(BaseModel):
    workflow_name: str = ""
    params: Dict[str, Any] = Field(default_factory=dict)
    client_id: str = ""
    convert_to_jpg: bool = False
