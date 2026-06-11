from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.dataset import Dataset
from models.kpi_definition import KpiDefinition
from models.report_recipe import ReportRecipe
from models.staging_table import StagingTable
from models.upload import Upload
from schemas.interview import (
    ApproveRecipeRequest,
    GenerateRecipeRequest,
    InterviewRequest,
    InterviewResponse,
    RecipeConfig,
    RecipeResponse,
    STEP_LABELS,
)
from schemas.upload import ProfilingResult
from services import ai_interview, recipe_generator

router = APIRouter(prefix="/interview", tags=["interview"])


def _get_client_id(x_client_id: str = Header(default="default")) -> str:
    return x_client_id


def _load_profile(upload_id: int, db: Session) -> ProfilingResult:
    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile not found — complete profiling first.")
    return ProfilingResult(**staging.profile_data)


def _recipe_response(recipe: ReportRecipe) -> RecipeResponse:
    return RecipeResponse(
        id=recipe.id,
        dataset_id=recipe.dataset_id,
        config=RecipeConfig(**recipe.config),
        version=recipe.version,
        approved_at=recipe.approved_at.isoformat() if recipe.approved_at else None,
    )


# ── Skip interview ────────────────────────────────────────────────────────────

@router.post("/skip", response_model=dict)
def skip_interview(
    body: dict,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Skip the interview step. AI builds recipe from schema + data model context."""
    dataset_id = body.get("dataset_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required.")

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    dataset.pipeline_stage = "kpi_selection"
    db.commit()

    return {
        "dataset_id": dataset_id,
        "pipeline_stage": dataset.pipeline_stage,
        "next_stage": "kpi_selection",
    }


@router.post("/recipe/from-context", response_model=RecipeResponse, status_code=201)
def create_recipe_from_context(
    body: dict,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Generate recipe from pipeline context (used when interview is skipped)."""
    dataset_id = body.get("dataset_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required.")

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    config = recipe_generator.generate_from_context(dataset_id, db)

    recipe = ReportRecipe(
        client_id=client_id,
        dataset_id=dataset_id,
        config=config.model_dump(),
        version=1,
    )
    db.add(recipe)
    db.flush()

    for kpi in config.kpis:
        db.add(KpiDefinition(
            client_id=client_id,
            recipe_id=recipe.id,
            name=kpi.name,
            formula=kpi.formula,
        ))

    dataset.pipeline_stage = "recipe"
    db.commit()
    db.refresh(recipe)
    return _recipe_response(recipe)


# ── Interview ─────────────────────────────────────────────────────────────────

@router.post("", response_model=InterviewResponse)
def run_interview(
    body: InterviewRequest,
    db: Session = Depends(get_db),
):
    profile = _load_profile(body.upload_id, db)
    history = [m.model_dump() for m in body.history]

    ai_message, step_index, completed, result = ai_interview.run(
        message=body.message,
        history=history,
        profile=profile,
    )

    return InterviewResponse(
        message=ai_message,
        step_index=step_index,
        step_label=STEP_LABELS[step_index - 1],
        completed=completed,
        interview_result=result,
    )


# ── Recipe ────────────────────────────────────────────────────────────────────

@router.post("/recipe", response_model=RecipeResponse, status_code=201)
def create_recipe(
    body: GenerateRecipeRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    upload = db.query(Upload).filter(Upload.id == body.upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    config = recipe_generator.generate(body.upload_id, upload.dataset_id, body.interview_result)

    recipe = ReportRecipe(
        client_id=client_id,
        dataset_id=upload.dataset_id,
        config=config.model_dump(),
        version=1,
    )
    db.add(recipe)
    db.flush()

    for kpi in body.interview_result.kpis:
        db.add(KpiDefinition(
            client_id=client_id,
            recipe_id=recipe.id,
            name=kpi.name,
            formula=kpi.formula,
        ))

    db.commit()
    db.refresh(recipe)
    return _recipe_response(recipe)


@router.get("/recipe/{recipe_id}", response_model=RecipeResponse)
def get_recipe(
    recipe_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    recipe = db.query(ReportRecipe).filter(
        ReportRecipe.id == recipe_id, ReportRecipe.client_id == client_id
    ).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")
    return _recipe_response(recipe)


@router.post("/recipe/{recipe_id}/approve", response_model=RecipeResponse)
def approve_recipe(
    recipe_id: int,
    body: ApproveRecipeRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    recipe = db.query(ReportRecipe).filter(
        ReportRecipe.id == recipe_id, ReportRecipe.client_id == client_id
    ).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")

    if body.config:
        recipe.config = body.config.model_dump()
        # Sync kpi_definitions to reflect any edits
        db.query(KpiDefinition).filter(KpiDefinition.recipe_id == recipe_id).delete()
        for kpi in body.config.kpis:
            db.add(KpiDefinition(
                client_id=client_id,
                recipe_id=recipe_id,
                name=kpi.name,
                formula=kpi.formula,
            ))

    recipe.approved_by = body.approved_by
    recipe.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(recipe)
    return _recipe_response(recipe)
