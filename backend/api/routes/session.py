"""
Session routes — multi-file pipeline flow.

POST /session/{dataset_id}/relationships      infer cross-file schema relationships
POST /session/{dataset_id}/interview          Flow 1 hybrid interview
GET  /session/{dataset_id}/interview/state    current step + collected answers
POST /session/{dataset_id}/interview/skip     skip interview, return default InterviewResult
POST /session/{dataset_id}/kpi-suggestions    suggest KPIs from catalog + interview
POST /session/{dataset_id}/validate           pre-dashboard data validation
POST /session/{dataset_id}/generate           create recipe + return recipe_id
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.upload import Upload
from services import schema_relationships as sr

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
    step: int
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
    return InterviewTurnResponse(
        message=response_text,
        step=step,
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


@router.post("/{dataset_id}/kpi-suggestions")
def kpi_suggestions(dataset_id: int, body: KpiSuggestRequest, db: Session = Depends(get_db)):
    from services.kpi_suggester import suggest

    profiles = _load_profiles(dataset_id, body.upload_ids, db)
    results = suggest(profiles, body.interview_answers)
    return results


# ── Validation ────────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    selected_kpi_ids: list[str] = []


@router.post("/{dataset_id}/validate")
def validate_data(dataset_id: int, body: ValidateRequest, db: Session = Depends(get_db)):
    from services.data_validator import validate
    from models.staging_table import StagingTable

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    staging_tables = []
    for u in uploads:
        st = db.query(StagingTable).filter(StagingTable.upload_id == u.id).first()
        if st:
            staging_tables.append(st)

    result = validate(staging_tables, body.selected_kpi_ids, db)
    return result


# ── Dashboard Generation ──────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    selected_kpi_ids: list[str] = []
    confirmed_relationships: list[dict] = []
    interview_result: dict = {}


class GenerateResponse(BaseModel):
    recipe_id: int


@router.post("/{dataset_id}/generate", response_model=GenerateResponse)
def generate_dashboard(dataset_id: int, body: GenerateRequest, db: Session = Depends(get_db)):
    from services.session_generator import generate_from_session

    recipe_id = generate_from_session(
        dataset_id=dataset_id,
        selected_kpi_ids=body.selected_kpi_ids,
        confirmed_relationships=body.confirmed_relationships,
        interview_result=body.interview_result,
        db=db,
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
        {**st.profile_data, "filename": st.upload.filename}
        for st in staging_rows
        if st.profile_data
    ]
