from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel


class UploadResponse(BaseModel):
    id: int
    dataset_id: int
    filename: str
    status: str
    file_type: str = "unknown"
    created_at: datetime

    model_config = {"from_attributes": True}


class ColumnProfile(BaseModel):
    name: str
    raw_dtype: str
    detected_type: Literal["date", "numeric", "categorical", "text"]
    suggested_role: Literal["date", "dimension", "measure"]
    missing_count: int
    missing_pct: float
    unique_count: int
    sample_values: list[Any]


class ProfilingResult(BaseModel):
    upload_id: int
    row_count: int
    duplicate_row_count: int
    columns: list[ColumnProfile]


class ColumnRoleOverride(BaseModel):
    name: str
    role: Literal["date", "dimension", "measure", "ignore"]


class ApproveProfileRequest(BaseModel):
    upload_id: int
    overrides: list[ColumnRoleOverride] = []
