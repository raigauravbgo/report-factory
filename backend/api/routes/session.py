"""
Session routes — multi-file pipeline flow.

POST /session/{dataset_id}/relationships      infer cross-file schema relationships
POST /session/{dataset_id}/interview          Flow 1 hybrid interview
GET  /session/{dataset_id}/interview/state    current step + collected answers
POST /session/{dataset_id}/interview/skip     skip interview, return default InterviewResult
POST /session/{dataset_id}/kpi-suggestions    suggest KPIs from catalog + interview
GET  /session/{dataset_id}/dimensions         list dimension columns across all uploaded files
POST /session/{dataset_id}/validate           pre-dashboard data validation
POST /session/{dataset_id}/generate           create recipe + return recipe_id
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.staging_table import StagingTable
from models.upload import Upload
from schemas.interview import STEP_LABELS as _STEP_LABELS  # H2: single source of truth
from services import schema_relationships as sr

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/session", tags=["session"])


# ── Relationships ─────────────────────────────────────────────────────────────

class RelationshipSuggestion(BaseModel):
    file_a: str
    col_a: str
    file_b: str
    col_b: str
    confidence: float
    relationship_type: str


@router.post("/{dataset_id}/relationships", response_model=list[RelationshipSuggestion])
def get_relationships(dataset_id: int, db: Session = Depends(get_db)):
    suggestions = sr.infer(dataset_id, db)
    return [RelationshipSuggestion(**vars(s)) for s in suggestions]


# ── Interview (Flow 1) ────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class InterviewRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    upload_ids: list[int] = []


class InterviewStateResponse(BaseModel):
    step: int
    answers: dict
    completed: bool


class InterviewTurnResponse(BaseModel):
    message: str
    step_index: int
    step_label: str
    completed: bool
    interview_result: dict | None = None



@router.post("/{dataset_id}/interview", response_model=InterviewTurnResponse)
def interview_turn(dataset_id: int, body: InterviewRequest, db: Session = Depends(get_db)):
    from services.ai_interview import run_flow1

    # Load profiles for uploaded files
    profiles = _load_profiles(dataset_id, body.upload_ids, db)

    response_text, step, completed, result = run_flow1(
        message=body.message,
        history=[m.model_dump() for m in body.history],
        profiles=profiles,
    )
    if completed:
        logger.info(
            "SESSION_INTERVIEW_DONE dataset_id=%d date_col=%r dims=%s granularity=%s",
            dataset_id,
            result.get("date_column") if result else None,
            result.get("dimensions", []) if result else [],
            result.get("granularity") if result else None,
        )
    else:
        logger.info("SESSION_INTERVIEW_TURN dataset_id=%d step=%d", dataset_id, step)
    label = _STEP_LABELS[step - 1] if 1 <= step <= len(_STEP_LABELS) else f"Step {step}"
    return InterviewTurnResponse(
        message=response_text,
        step_index=step,
        step_label=label,
        completed=completed,
        interview_result=result,
    )


@router.get("/{dataset_id}/interview/state", response_model=InterviewStateResponse)
def interview_state(dataset_id: int):
    # Stateless — state is maintained by the frontend's history array
    return InterviewStateResponse(step=0, answers={}, completed=False)


@router.post("/{dataset_id}/interview/skip", response_model=dict)
def skip_interview(dataset_id: int, db: Session = Depends(get_db)):
    profiles = _load_profiles(dataset_id, [], db)
    from services.ai_interview import default_interview_result
    return default_interview_result(profiles)


# ── KPI Suggestions ───────────────────────────────────────────────────────────

class KpiSuggestRequest(BaseModel):
    upload_ids: list[int] = []
    interview_answers: dict = {}


class KpiSuggestionResponse(BaseModel):
    kpi_id: str
    display_name: str
    formula: str
    confidence: float
    matched_columns: dict = {}
    source: str = "catalog"
    domain: str | None = None
    aggregation: str = ""
    format: str = ""


@router.post("/{dataset_id}/kpi-suggestions", response_model=list[KpiSuggestionResponse])  # M12
def kpi_suggestions(dataset_id: int, body: KpiSuggestRequest, db: Session = Depends(get_db)):
    from services.kpi_suggester import suggest

    profiles = _load_profiles(dataset_id, body.upload_ids, db)
    if not profiles:
        logger.warning(
            "kpi_suggestions: no profile data found for dataset_id=%d "
            "(profiling may still be running or all uploads failed)",
            dataset_id,
        )
        return []
    try:
        return suggest(profiles, body.interview_answers)
    except Exception as exc:
        logger.error("kpi_suggestions: unexpected error dataset_id=%d: %s", dataset_id, exc)
        return []


# ── Dimensions ───────────────────────────────────────────────────────────────

class DimensionColumn(BaseModel):
    name: str
    source_file: str
    semantic_tag: str | None = None
    unique_count: int
    sample_values: list[str] = []


@router.get("/{dataset_id}/dimensions", response_model=list[DimensionColumn])
def get_dimensions(dataset_id: int, db: Session = Depends(get_db)):
    """Aggregate dimension columns from all uploads in the dataset.

    A column qualifies when suggested_role == "dimension" and semantic_tag is not
    entity_key, time_key, or financial_metric. Columns are deduplicated by name
    (last file wins on collision).
    """
    staging_rows = (
        db.query(StagingTable)
        .join(Upload, StagingTable.upload_id == Upload.id)
        .filter(Upload.dataset_id == dataset_id)
        .all()
    )
    seen: dict[str, DimensionColumn] = {}
    for st in staging_rows:
        if not st.profile_data:
            continue
        source_file = st.upload.filename
        for col in st.profile_data.get("columns", []):
            role = col.get("suggested_role", "")
            tag = col.get("semantic_tag", "")
            if role != "dimension":
                continue
            if tag in ("entity_key", "time_key", "financial_metric"):
                continue
            samples = [str(v) for v in (col.get("sample_values") or [])[:5]]
            seen[col["name"]] = DimensionColumn(
                name=col["name"],
                source_file=source_file,
                semantic_tag=tag or None,
                unique_count=col.get("unique_count", 0),
                sample_values=samples,
            )
    return list(seen.values())


# ── Validation ────────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    selected_kpi_ids: list[str] = []   # legacy: catalog kpi_ids
    selected_kpis: list[dict] = []     # AI-generated: full KPI dicts with formula


@router.post("/{dataset_id}/validate")  # M13: response_model omitted — shape varies per validator
def validate_data(dataset_id: int, body: ValidateRequest, db: Session = Depends(get_db)):
    from services.data_validator import validate

    # H3: Single JOIN query replaces N+1 (one query per upload)
    staging_tables = (
        db.query(StagingTable)
        .join(Upload, StagingTable.upload_id == Upload.id)
        .filter(Upload.dataset_id == dataset_id)
        .all()
    )

    result = validate(
        staging_tables,
        body.selected_kpi_ids,
        db,
        selected_kpis=body.selected_kpis,
    )
    return result


# ── Dashboard Generation ──────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    selected_kpis: list[dict] = []
    confirmed_relationships: list[dict] = []
    interview_result: dict = {}


class GenerateResponse(BaseModel):
    recipe_id: int


@router.post("/{dataset_id}/generate", response_model=GenerateResponse)
def generate_dashboard(dataset_id: int, body: GenerateRequest, db: Session = Depends(get_db)):
    from services.session_generator import generate_from_session

    recipe_id = generate_from_session(
        dataset_id=dataset_id,
        selected_kpis=body.selected_kpis,
        confirmed_relationships=body.confirmed_relationships,
        interview_result=body.interview_result,
        db=db,
    )
    logger.info(
        "GENERATE_DONE dataset_id=%d recipe_id=%d kpis=%d date_col=%r",
        dataset_id, recipe_id, len(body.selected_kpis),
        body.interview_result.get("date_column"),
    )
    return GenerateResponse(recipe_id=recipe_id)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_profiles(dataset_id: int, upload_ids: list[int], db: Session) -> list[dict]:
    from models.staging_table import StagingTable

    query = db.query(StagingTable).join(Upload).filter(Upload.dataset_id == dataset_id)
    if upload_ids:
        query = query.filter(Upload.id.in_(upload_ids))
    staging_rows = query.all()
    return [
        {
            **st.profile_data,
            "filename": st.upload.filename,
            # Passed to kpi_suggester so it can load actual rows instead of
            # reconstructing from per-column sample_values.
            "staging_table_name": st.table_name,
        }
        for st in staging_rows
        if st.profile_data
    ]
