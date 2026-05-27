from typing import Any, Optional
from pydantic import BaseModel


class AnalysisRequest(BaseModel):
    kpi_ids: list[str]


class MappingEntry(BaseModel):
    canonical_name: str
    confidence: float
    status: str
    reasoning: str = ""


class MappingConfirmRequest(BaseModel):
    mapping: dict[str, MappingEntry]


class KpiFeasibilityBlocked(BaseModel):
    id: str
    name: str
    missing_columns: list[str]


class MappingConfirmResponse(BaseModel):
    upload_id: int
    recipe_id: int
    available_kpis: list[str]
    blocked_kpis: list[KpiFeasibilityBlocked]


class KpiResult(BaseModel):
    kpi_id: str
    name: str
    value: Optional[Any] = None
    breakdown: Optional[dict[str, Any]] = None
    chart_type: str = "bar"
    unit: str = ""
    error: Optional[str] = None


class DashboardResult(BaseModel):
    upload_id: int
    recipe_id: int
    status: str
    kpi_results: list[KpiResult] = []


class AnalysisStatusResponse(BaseModel):
    upload_id: int
    status: str
    recipe_id: Optional[int] = None
