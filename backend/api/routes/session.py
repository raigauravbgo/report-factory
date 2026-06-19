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
    is_adk_mode: bool = False



@router.post("/{dataset_id}/interview", response_model=InterviewTurnResponse)
def interview_turn(dataset_id: int, body: InterviewRequest, db: Session = Depends(get_db)):
    from services.ai_interview import run_flow1
    from core.config import settings

    # ── Flow 2: ADK agent (when ADK_ENABLED=true) ────────────────────────────
    if settings.adk_enabled:
        try:
            import re as _re
            from services.adk_runner import run_turn

            session_id = f"session_{dataset_id}"

            if not body.message:
                # First turn: inject dataset context so the agent follows SESSION FLOW
                # If the frontend sends an empty upload_ids list (race on first render),
                # fall back to loading all uploads for this dataset from the DB.
                upload_ids = body.upload_ids
                if not upload_ids:
                    rows = db.query(Upload.id).filter(Upload.dataset_id == dataset_id).all()
                    upload_ids = [r[0] for r in rows]

                profiles = _load_profiles(dataset_id, upload_ids, db)
                primary_upload_id = upload_ids[0] if upload_ids else 0
                filenames = [p.get("filename", "") for p in profiles]
                date_cols = [
                    c["name"] for p in profiles
                    for c in p.get("columns", [])
                    if c.get("suggested_role") == "date"
                ]
                dim_cols = [
                    c["name"] for p in profiles
                    for c in p.get("columns", [])
                    if c.get("suggested_role") == "dimension"
                ]
                msr_cols = [
                    c["name"] for p in profiles
                    for c in p.get("columns", [])
                    if c.get("suggested_role") == "measure"
                ]
                adk_message = (
                    f"[DATASET UPLOADED]\n"
                    f"dataset_id: {dataset_id}\n"
                    f"upload_ids: {upload_ids}\n"
                    f"files: {', '.join(filenames)}\n"
                    f"primary_upload_id: {primary_upload_id}\n"
                    f"likely date columns: {', '.join(date_cols[:3]) or 'none detected'}\n"
                    f"likely dimensions: {', '.join(dim_cols[:5]) or 'none detected'}\n"
                    f"likely measures: {', '.join(msr_cols[:5]) or 'none detected'}\n\n"
                    "Follow the SESSION FLOW instructions."
                )
            else:
                adk_message = body.message

            # Record highest recipe ID before the turn so we can detect new ones after
            from models.report_recipe import ReportRecipe
            pre_turn_recipe = (
                db.query(ReportRecipe.id)
                .filter(ReportRecipe.dataset_id == dataset_id)
                .order_by(ReportRecipe.id.desc())
                .first()
            )
            pre_turn_max_id = pre_turn_recipe[0] if pre_turn_recipe else 0

            from services.observability import create_trace_event as _trace
            _trace(
                run_id=f"session_{dataset_id}",
                step_name="interview_turn",
                skill_name="adk_runner.run_turn",
                status="pending",
                message="ADK agent processing turn",
                evidence_json={"dataset_id": dataset_id, "first_turn": not body.message},
            )

            ai_message = run_turn(session_id, adk_message)

            # Primary: check DB for a new recipe created during this turn.
            # This is reliable even when the agent paraphrases the tool result
            # instead of returning [DASHBOARD_READY recipe_id=N] verbatim.
            db.expire_all()  # flush SQLAlchemy identity map so fresh rows appear
            new_recipe = (
                db.query(ReportRecipe.id)
                .filter(
                    ReportRecipe.dataset_id == dataset_id,
                    ReportRecipe.id > pre_turn_max_id,
                )
                .order_by(ReportRecipe.id.desc())
                .first()
            )
            recipe_id: int | None = new_recipe[0] if new_recipe else None

            # Fallback: parse [DASHBOARD_READY recipe_id=N] token if agent included it
            if recipe_id is None:
                match = _re.search(r"\[DASHBOARD_READY recipe_id=(\d+)\]", ai_message)
                if match:
                    recipe_id = int(match.group(1))

            completed = recipe_id is not None
            result = {"recipe_id": recipe_id} if recipe_id else None
            # Strip the token from display text if present
            display = _re.sub(r"\[DASHBOARD_READY recipe_id=\d+\]\s*", "", ai_message).strip()
            label = _STEP_LABELS[0] if _STEP_LABELS else "Step 1"

            if completed:
                logger.info(
                    "SESSION_ADK_DONE dataset_id=%d recipe_id=%d",
                    dataset_id, recipe_id,
                )
                _trace(
                    run_id=f"session_{dataset_id}",
                    step_name="interview_turn",
                    skill_name="adk_runner.run_turn",
                    status="success",
                    confidence=1.0,
                    message=f"ADK session complete — recipe_id={recipe_id}",
                    evidence_json={"dataset_id": dataset_id, "recipe_id": recipe_id},
                )
            else:
                logger.info("SESSION_ADK_TURN dataset_id=%d", dataset_id)
                _trace(
                    run_id=f"session_{dataset_id}",
                    step_name="interview_turn",
                    skill_name="adk_runner.run_turn",
                    status="pending",
                    message="ADK turn completed — awaiting further user input",
                    evidence_json={"dataset_id": dataset_id},
                )

            return InterviewTurnResponse(
                message=display,
                step_index=1,
                step_label=label,
                completed=completed,
                interview_result=result,
                is_adk_mode=True,
            )
        except Exception as e:
            logger.warning(
                "SESSION_ADK_FALLBACK dataset_id=%d error=%r — falling back to Flow 1",
                dataset_id, str(e),
            )
            try:
                from services.observability import create_trace_event as _trace
                _trace(
                    run_id=f"session_{dataset_id}",
                    step_name="interview_turn",
                    skill_name="adk_runner.run_turn",
                    status="error",
                    message=f"ADK failed, falling back to Flow 1: {e}",
                    evidence_json={"dataset_id": dataset_id, "error": str(e)},
                    requires_review=True,
                )
            except Exception:
                pass

    # ── Flow 1: OpenAI fallback (always runs if ADK disabled or failed) ───────
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
    source_file: str          # "multiple" when the column spans > 1 staging table
    semantic_tag: str | None = None
    unique_count: int
    sample_values: list[str] = []
    table_count: int = 1      # how many staging tables contain this column


_DIM_EXCLUDED_TAGS = frozenset({"entity_key", "time_key", "financial_metric"})


@router.get("/{dataset_id}/dimensions", response_model=list[DimensionColumn])
def get_dimensions(dataset_id: int, db: Session = Depends(get_db)):
    """Return dimension columns using a Power BI star-schema priority order.

    Branch 1 — virtual_dimension table(s) exist:
        Use their dimension columns (pre-filtered to stable shared columns).
    Branch 2 — regular dimension table(s) exist (table_type == "dimension"):
        Use their dimension columns (the canonical categorical attributes).
    Branch 3 — no dimension tables:
        Use columns that appear in >= 2 fact/unknown tables (genuinely shared).
    Branch 4 — fallback (heterogeneous or single-file dataset):
        Return all dimension-role columns (matches previous behaviour).

    In every branch, table_count reflects how many staging tables hold the column
    so the UI can show "all tables" / "N tables" badges.
    """
    staging_rows = (
        db.query(StagingTable)
        .join(Upload, StagingTable.upload_id == Upload.id)
        .filter(Upload.dataset_id == dataset_id)
        .all()
    )
    if not staging_rows:
        return []

    # ── Phase 1: build global cross-table column index ────────────────────────
    # col_name → {count, best_unique, best_samples, best_file, semantic_tag}
    col_index: dict[str, dict] = {}
    virtual_dim_stagings: list = []
    real_dim_stagings: list = []

    for st in staging_rows:
        if not st.profile_data:
            continue
        table_type = st.profile_data.get("table_type", "unknown")
        if table_type == "virtual_dimension":
            virtual_dim_stagings.append(st)
        elif table_type == "dimension":
            real_dim_stagings.append(st)

        for col in st.profile_data.get("columns", []):
            if col.get("suggested_role") != "dimension":
                continue
            if col.get("semantic_tag") in _DIM_EXCLUDED_TAGS:
                continue
            cname = col["name"]
            ucount = col.get("unique_count", 0)
            if cname not in col_index:
                col_index[cname] = {
                    "count": 0,
                    "best_unique": ucount,
                    "best_samples": [str(v) for v in (col.get("sample_values") or [])[:5]],
                    "best_file": st.upload.filename,
                    "semantic_tag": col.get("semantic_tag") or None,
                }
            col_index[cname]["count"] += 1
            if ucount > col_index[cname]["best_unique"]:
                col_index[cname]["best_unique"] = ucount
                col_index[cname]["best_samples"] = [str(v) for v in (col.get("sample_values") or [])[:5]]
                col_index[cname]["best_file"] = st.upload.filename

    def _make_result(names: "set[str]") -> "list[DimensionColumn]":
        result = []
        for name in names:
            if name not in col_index:
                continue
            info = col_index[name]
            tc = info["count"]
            result.append(DimensionColumn(
                name=name,
                source_file="multiple" if tc > 1 else info["best_file"],
                semantic_tag=info["semantic_tag"],
                unique_count=info["best_unique"],
                sample_values=info["best_samples"],
                table_count=tc,
            ))
        result.sort(key=lambda d: (-d.table_count, d.name))
        return result

    # ── Branch 1: virtual_dimension table(s) ─────────────────────────────────
    if virtual_dim_stagings:
        candidates: set[str] = set()
        for st in virtual_dim_stagings:
            for col in st.profile_data.get("columns", []):
                if col.get("suggested_role") == "dimension" and col.get("semantic_tag") not in _DIM_EXCLUDED_TAGS:
                    candidates.add(col["name"])
        if candidates:
            logger.info("get_dimensions dataset_id=%d branch=virtual_dimension cols=%d", dataset_id, len(candidates))
            return _make_result(candidates)

    # ── Branch 2: regular dimension table(s) ─────────────────────────────────
    if real_dim_stagings:
        candidates = set()
        for st in real_dim_stagings:
            for col in st.profile_data.get("columns", []):
                if col.get("suggested_role") == "dimension" and col.get("semantic_tag") not in _DIM_EXCLUDED_TAGS:
                    candidates.add(col["name"])
        if candidates:
            logger.info("get_dimensions dataset_id=%d branch=dimension_tables cols=%d", dataset_id, len(candidates))
            return _make_result(candidates)

    # ── Branch 3: columns shared across >= 2 tables ───────────────────────────
    shared = {name for name, info in col_index.items() if info["count"] >= 2}
    if shared:
        logger.info("get_dimensions dataset_id=%d branch=shared_columns cols=%d", dataset_id, len(shared))
        return _make_result(shared)

    # ── Branch 4: fallback — single-file or fully heterogeneous ──────────────
    logger.info("get_dimensions dataset_id=%d branch=fallback_all cols=%d", dataset_id, len(col_index))
    return _make_result(set(col_index.keys()))


# ── Virtual Dimension ─────────────────────────────────────────────────────────

class VirtualDimensionResponse(BaseModel):
    upload_id: int
    table_name: str
    row_count: int
    column_count: int
    columns: list[str]


@router.post("/{dataset_id}/virtual-dimension", response_model=VirtualDimensionResponse)
def create_virtual_dimension(dataset_id: int, db: Session = Depends(get_db)):
    """
    Build a virtual dimension from columns shared across 2+ fact tables.

    Useful when no real dimension/Roster file was uploaded. The virtual
    dimension is stored as a StagingTable with table_type='virtual_dimension'
    and is then available for filter enrichment like any real dimension file.
    """
    from core.database import engine as app_engine
    from services.virtual_dimension import store_virtual_dimension

    # Load all staging tables for the dataset (excluding virtual dims already built)
    staging_rows = (
        db.query(StagingTable)
        .join(Upload, StagingTable.upload_id == Upload.id)
        .filter(Upload.dataset_id == dataset_id)
        .filter(Upload.filename != "__virtual_dimension__")
        .all()
    )
    if not staging_rows:
        raise HTTPException(status_code=404, detail="No uploads found for this dataset")

    # Fetch the dataset's client_id via the first upload
    client_id = staging_rows[0].upload.dataset.client_id

    # Load DataFrames from physical staging tables
    import pandas as pd
    from sqlalchemy import text

    staging_dfs: list[tuple[str, pd.DataFrame]] = []
    for st in staging_rows:
        try:
            with app_engine.connect() as conn:
                df = pd.read_sql(text(f'SELECT * FROM "{st.table_name}"'), con=conn)
            staging_dfs.append((st.table_name, df))
        except Exception as exc:
            logger.warning("virtual_dimension: could not load %s: %s", st.table_name, exc)

    if not staging_dfs:
        raise HTTPException(status_code=422, detail="No staging data could be loaded")

    result_st = store_virtual_dimension(
        dataset_id=dataset_id,
        staging_dfs=staging_dfs,
        db=db,
        engine=app_engine,
        client_id=client_id,
    )

    if result_st is None:
        raise HTTPException(
            status_code=422,
            detail="No common dimension columns found across fact tables. "
                   "Cannot build a virtual dimension.",
        )

    vd_cols = [c["name"] for c in (result_st.profile_data.get("columns") or [])]
    return VirtualDimensionResponse(
        upload_id=result_st.upload_id,
        table_name=result_st.table_name,
        row_count=result_st.row_count,
        column_count=result_st.column_count,
        columns=vd_cols,
    )


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
