from typing import Literal
from pydantic import BaseModel

STEP_LABELS = [
    "Date column",
    "KPI definitions",
    "Dimensions",
    "Time granularity",
    "Filters",
]


# ── Core building blocks ──────────────────────────────────────────────────────

class KpiSpec(BaseModel):
    name: str
    formula: str


class InterviewResult(BaseModel):
    date_column: str
    kpis: list[KpiSpec]
    dimensions: list[str]
    granularity: str          # daily | weekly | monthly
    filters: list[str]


class ChatMessage(BaseModel):
    role: str                 # user | assistant
    content: str


# ── Interview endpoints ───────────────────────────────────────────────────────

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


# ── Recipe ────────────────────────────────────────────────────────────────────

class ChartConfig(BaseModel):
    type: str                 # line | bar | table | kpi_card
    kpi: str
    title: str
    group_by: str | None = None
    null_handling: str = "exclude_nulls"  # exclude_nulls | treat_as_zero | carry_forward


class RecipeConfig(BaseModel):
    # Legacy single-file field — kept for backward compat
    upload_id: int
    dataset_id: int
    # Multi-file fields
    upload_ids: list[int] = []
    interview_skipped: bool = False
    selected_kpi_ids: list[str] = []
    dimension_table_upload_ids: list[int] = []
    selected_dimensions: list[str] = []
    # Core config
    column_mappings: dict[str, str]
    date_column: str
    granularity: str
    dimensions: list[str]
    filters: list[str]
    kpis: list[KpiSpec]
    chart_layout: list[ChartConfig]


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


# ── Schema mapping ────────────────────────────────────────────────────────────

class ColumnSchemaOverride(BaseModel):
    column_name: str
    detected_type: Literal["int", "float", "boolean", "text", "date"] | None = None
    role: Literal["measure", "date", "dimension", "boolean"] | None = None
    is_filter_candidate: bool | None = None


class ConfirmSchemaRequest(BaseModel):
    upload_id: int
    overrides: list[ColumnSchemaOverride] = []


class ColumnSchemaEntry(BaseModel):
    id: int
    upload_id: int
    column_name: str
    raw_dtype: str
    ai_detected_type: str
    ai_role: str
    ai_is_filter: bool
    ai_confidence: float
    confirmed_type: str | None
    confirmed_role: str | None
    confirmed_is_filter: bool | None
    effective_type: str
    effective_role: str
    effective_is_filter: bool
    unique_count: int
    missing_pct: float
    sample_values: list | None

    model_config = {"from_attributes": True}


class DatasetSchemaResponse(BaseModel):
    dataset_id: int
    uploads: list[dict]  # {upload_id, filename, status, columns: list[ColumnSchemaEntry]}


# ── Data modeling ─────────────────────────────────────────────────────────────

class TableRoleOverride(BaseModel):
    upload_id: int
    role: Literal["fact", "dimension"]


class ForeignKeyOverride(BaseModel):
    from_upload_id: int
    from_col: str
    to_upload_id: int
    to_col: str
    confirmed: bool  # False = user is removing this FK


class ConfirmDataModelRequest(BaseModel):
    dataset_id: int
    table_overrides: list[TableRoleOverride] = []
    pk_overrides: dict[str, list[str]] = {}  # upload_id (as str) → [col_name]
    fk_overrides: list[ForeignKeyOverride] = []


class DataModelTableEntry(BaseModel):
    upload_id: int
    filename: str
    role: str
    confidence: float
    confirmed_role: str | None


class DataModelFkEntry(BaseModel):
    from_upload_id: int
    from_col: str
    to_upload_id: int
    to_col: str
    confidence: float
    integrity_pct: float | None
    confirmed: bool


class DataModelResponse(BaseModel):
    id: int
    dataset_id: int
    status: str
    tables: list[DataModelTableEntry]
    primary_keys: dict[str, list[str]]
    foreign_keys: list[DataModelFkEntry]
    ai_reasoning: str | None
    validation: "ValidationResult | None" = None

    model_config = {"from_attributes": True}


# ── KPI suggestions ───────────────────────────────────────────────────────────

class KpiSuggestion(BaseModel):
    kpi_id: str
    display_name: str
    domain: str
    formula: str
    relevance_score: float
    reasoning: str


class KpiSelectionRequest(BaseModel):
    dataset_id: int
    selected_kpi_ids: list[str]
    custom_kpis: list[KpiSpec] = []


# ── Dimension suggestions ─────────────────────────────────────────────────────

class DimensionSuggestion(BaseModel):
    column_name: str
    upload_id: int
    table_name: str
    display_label: str
    is_recommended: bool
    reasoning: str


class DimensionSelectionRequest(BaseModel):
    dataset_id: int
    selected_dimensions: list[str]


# ── Validation ────────────────────────────────────────────────────────────────

class ValidationError(BaseModel):
    field: str
    message: str
    severity: Literal["error", "warning"]


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationError] = []
