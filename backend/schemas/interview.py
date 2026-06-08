from __future__ import annotations

from pydantic import BaseModel

STEP_LABELS = [
    "Data type",        # H2: aligned with session Flow 1 (6 steps)
    "Date column",
    "KPI definitions",
    "Dimensions",
    "Time granularity",
    "Filters",
]


class KpiSpec(BaseModel):
    name: str
    formula: str
    aggregation: str = ""
    format: str = ""          # H6: percentage | currency | duration | number


class InterviewResult(BaseModel):
    domain: str | None = None  # H1: data domain collected in Q1
    date_column: str
    kpis: list[KpiSpec]
    dimensions: list[str]
    granularity: str          # daily | weekly | monthly
    filters: list[str]


class ChatMessage(BaseModel):
    role: str                 # user | assistant
    content: str


class InterviewRequest(BaseModel):
    upload_id: int
    message: str
    history: list[ChatMessage] = []


class InterviewResponse(BaseModel):
    message: str
    step_index: int           # 1–5
    step_label: str
    completed: bool
    interview_result: InterviewResult | None = None


class ChartConfig(BaseModel):
    type: str                 # line | bar
    kpi: str
    title: str
    group_by: str | None = None


class RecipeConfig(BaseModel):
    upload_id: int
    dataset_id: int
    column_mappings: dict[str, str] = {}
    date_column: str | None = None   # L7: Optional — may be absent in partial configs
    granularity: str = "monthly"
    dimensions: list[str] = []
    filters: list[str] = []
    kpis: list[KpiSpec] = []
    chart_layout: list[ChartConfig] = []


class GenerateRecipeRequest(BaseModel):
    upload_id: int
    interview_result: InterviewResult


class ApproveRecipeRequest(BaseModel):
    approved_by: str = "user"
    config: RecipeConfig | None = None  # if provided, updates config before approving


class RecipeResponse(BaseModel):
    id: int
    dataset_id: int
    config: RecipeConfig
    version: int
    approved_at: str | None = None
