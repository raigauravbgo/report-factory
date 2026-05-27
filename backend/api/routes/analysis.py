from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.upload import Upload
from models.staging_table import StagingTable
from models.report_recipe import ReportRecipe
from models.dataset import Dataset
from schemas.analysis import (
    AnalysisRequest,
    AnalysisStatusResponse,
    DashboardResult,
    KpiResult,
)

router = APIRouter(prefix="/api/sessions", tags=["analysis"])


@router.post("/{upload_id}/analyze", status_code=202)
def start_analysis(
    upload_id: int,
    body: AnalysisRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")
    if upload.status not in ("profiled",):
        raise HTTPException(400, f"Upload must be in 'profiled' state to analyze. Current: {upload.status}")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging:
        raise HTTPException(404, "Staging table not found. Ensure profiling has completed.")
    if not staging.mapping_confirmed:
        raise HTTPException(400, "Column mapping must be confirmed before analysis.")

    # Find or create a recipe linked to this upload
    recipe = db.query(ReportRecipe).filter(ReportRecipe.upload_id == upload_id).first()
    if not recipe:
        recipe = ReportRecipe(
            client_id=upload.client_id,
            dataset_id=upload.dataset_id,
            upload_id=upload_id,
            config={},
            analysis_status="pending",
        )
        db.add(recipe)
        db.commit()
        db.refresh(recipe)

    recipe.selected_kpi_ids = body.kpi_ids
    recipe.analysis_status = "running"
    db.commit()

    upload.status = "analyzing"
    db.commit()

    background_tasks.add_task(_run_analysis, upload_id, recipe.id, body.kpi_ids)
    return {"upload_id": upload_id, "recipe_id": recipe.id, "status": "analyzing"}


@router.get("/{upload_id}/status", response_model=AnalysisStatusResponse)
def get_analysis_status(upload_id: int, db: Session = Depends(get_db)):
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    recipe = db.query(ReportRecipe).filter(ReportRecipe.upload_id == upload_id).first()
    return AnalysisStatusResponse(
        upload_id=upload_id,
        status=upload.status,
        recipe_id=recipe.id if recipe else None,
    )


@router.get("/{upload_id}/dashboard", response_model=DashboardResult)
def get_dashboard(upload_id: int, db: Session = Depends(get_db)):
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    recipe = db.query(ReportRecipe).filter(ReportRecipe.upload_id == upload_id).first()
    if not recipe or not recipe.computed_kpis:
        raise HTTPException(404, "Dashboard results not yet available. Check /status first.")

    kpi_results = [KpiResult(**v) for v in recipe.computed_kpis.values()]
    return DashboardResult(
        upload_id=upload_id,
        recipe_id=recipe.id,
        status=upload.status,
        kpi_results=kpi_results,
    )


# ── Background analysis task ───────────────────────────────────────────────────

def _run_analysis(upload_id: int, recipe_id: int, kpi_ids: list[str]) -> None:
    from core.database import SessionLocal
    from medallion import bronze, silver, gold
    from kpi_registry.registry import KPIRegistry
    import services.storage as storage_svc
    import io

    db = SessionLocal()
    try:
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
        recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()

        if not upload or not staging or not recipe:
            return

        # Download file from storage
        file_bytes = storage_svc.download_bytes(upload.s3_key)
        import tempfile, os
        suffix = "." + upload.filename.rsplit(".", 1)[-1].lower()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            # Bronze layer
            bronze_result = bronze.ingest(tmp_path, file_type=upload.file_type)

            # Silver layer
            registry = KPIRegistry()
            column_mapping = staging.column_mapping or {}
            silver_result = silver.clean(bronze_result["dataframe"], column_mapping, registry=registry)

            # Gold layer
            frames = {"main": silver_result}
            kpi_results = gold.compute(frames, kpi_ids, registry)

            recipe.computed_kpis = kpi_results
            recipe.analysis_status = "complete"
            upload.status = "complete"
            db.commit()

        finally:
            os.unlink(tmp_path)

    except Exception as exc:
        db.rollback()
        upload_rec = db.query(Upload).filter(Upload.id == upload_id).first()
        recipe_rec = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
        if upload_rec:
            upload_rec.status = "failed"
            upload_rec.error_message = str(exc)
        if recipe_rec:
            recipe_rec.analysis_status = "error"
        db.commit()
    finally:
        db.close()
