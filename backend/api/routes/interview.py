from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

import logging

from core.config import settings
from core.database import get_db
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

logger = logging.getLogger(__name__)

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


# ── Interview ─────────────────────────────────────────────────────────────────

@router.post("", response_model=InterviewResponse)
def run_interview(
    body: InterviewRequest,
    db: Session = Depends(get_db),
):
    profile = _load_profile(body.upload_id, db)
    history = [m.model_dump() for m in body.history]

    # ── Flow 2: ADK agent (when ADK_ENABLED=true) ─────────────────────────────
    if settings.adk_enabled:
        try:
            from services.adk_runner import run_turn
            session_id = f"upload_{body.upload_id}"

            # On first turn (empty message), inject the column profile so the
            # ADK agent knows which columns exist and can call the right tool.
            if not body.message:
                date_cols = [c.name for c in profile.columns if c.suggested_role == "date"]
                dim_cols  = [c.name for c in profile.columns if c.suggested_role == "dimension"]
                msr_cols  = [c.name for c in profile.columns if c.suggested_role == "measure"]
                all_cols  = ", ".join(
                    f"{c.name} ({c.detected_type})"
                    for c in profile.columns
                )
                adk_message = (
                    f"[FILE UPLOADED]\n"
                    f"upload_id: {body.upload_id}\n"
                    f"rows: {profile.row_count:,}\n"
                    f"columns ({len(profile.columns)} total): {all_cols}\n"
                    f"likely date columns: {', '.join(date_cols) or 'none detected'}\n"
                    f"likely dimensions: {', '.join(dim_cols[:5]) or 'none detected'}\n"
                    f"likely measures: {', '.join(msr_cols[:5]) or 'none detected'}\n\n"
                    "The file is already uploaded and profiled. "
                    "Greet the user, summarise what you can see in the data, "
                    "and start the intake interview. "
                    "When Step 2 (data discovery) is reached, call "
                    f"run_data_discovery_from_upload(upload_id={body.upload_id}) — "
                    "do NOT ask the user to upload again."
                )
            else:
                adk_message = body.message

            ai_message = run_turn(session_id, adk_message)

            # Reuse Flow 1 extraction logic to parse step/completion from response
            updated = list(history)
            if body.message:
                updated.append({"role": "user", "content": body.message})
            updated.append({"role": "assistant", "content": ai_message})
            extracted = ai_interview._extract(updated, profile)
            step = ai_interview._step(extracted)
            done = ai_interview._complete(extracted) or "[INTERVIEW_COMPLETE]" in ai_message
            result = ai_interview._to_result(extracted) if done else None
            display = ai_message.replace("[INTERVIEW_COMPLETE]", "").strip()

            return InterviewResponse(
                message=display,
                step_index=step,
                step_label=STEP_LABELS[step - 1],
                completed=done,
                interview_result=result,
            )
        except Exception as e:
            logger.warning("ADK_FALLBACK upload_id=%d error=%r", body.upload_id, str(e))

    # ── Flow 1: OpenAI fallback (always runs if ADK disabled or failed) ────────
    ai_message, step_index, completed, result = ai_interview.run(
        message=body.message,
        history=history,
        profile=profile,
    )
    if completed:
        logger.info(
            "INTERVIEW_DONE upload_id=%d date_col=%r dims=%s granularity=%s filters=%s",
            body.upload_id,
            result.date_column if result else None,
            result.dimensions if result else [],
            result.granularity if result else None,
            result.filters if result else [],
        )
    else:
        logger.info("INTERVIEW_TURN upload_id=%d step=%d completed=False", body.upload_id, step_index)
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
    logger.info("RECIPE_CREATED recipe_id=%d upload_id=%d kpis=%d client=%s",
                recipe.id, body.upload_id, len(body.interview_result.kpis), client_id)
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
    logger.info("RECIPE_APPROVED recipe_id=%d approved_by=%r", recipe_id, body.approved_by)
    return _recipe_response(recipe)
