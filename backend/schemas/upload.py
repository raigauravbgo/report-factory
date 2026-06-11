from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel


class UploadResponse(BaseModel):
    id: int
    dataset_id: int
    filename: str
    status: str
    error_message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BatchUploadItem(BaseModel):
    upload_id: int
    filename: str
    status: str


class BatchUploadResponse(BaseModel):
    dataset_id: int
    uploads: list[BatchUploadItem]


class ColumnProfile(BaseModel):
    name: str
    raw_dtype: str
    detected_type: Literal["date", "numeric", "categorical", "text"]
    suggested_role: Literal["date", "dimension", "measure"]
    missing_count: int
    missing_pct: float
    unique_count: int
    sample_values: list[Any]
    # Extended profiling fields
    semantic_tag: Literal[
        "entity_key", "time_key", "financial_metric", "dimension", "text", "ignore"
    ] = "dimension"
    grain_score: float = 0.0
    grain_candidate: bool = False
    is_filter: bool = False


class ProfilingResult(BaseModel):
    upload_id: int
    row_count: int
    duplicate_row_count: int
    columns: list[ColumnProfile]
    # File-level metadata from deep profiling
    encoding: str = "utf-8"
    delimiter: str = ","
    sheet_names: list[str] = []
    active_sheet: str = ""
    grain_suggestions: list[str] = []
    # AI-suggested table classification; user can override via PATCH /upload/{id}/table-type
    table_type: str = "unknown"


class ColumnRoleOverride(BaseModel):
    name: str
    role: Literal["date", "dimension", "measure", "ignore"]


class ColumnSchemaOverride(BaseModel):
    name: str
    detected_type: Optional[Literal["date", "numeric", "categorical", "text"]] = None
    suggested_role: Optional[Literal["date", "dimension", "measure", "ignore"]] = None
    semantic_tag: Optional[Literal[
        "entity_key", "time_key", "financial_metric", "dimension", "text", "ignore"
    ]] = None
    in_grain: Optional[bool] = None
    in_filter: Optional[bool] = None


class SaveSchemaOverridesRequest(BaseModel):
    column_overrides: list[ColumnSchemaOverride] = []
    active_sheet: Optional[str] = None


class ApproveProfileRequest(BaseModel):
    upload_id: int
    overrides: list[ColumnRoleOverride] = []
