import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from core.database import get_db
from models.upload import Upload
from models.report_recipe import ReportRecipe

router = APIRouter(prefix="/api/sessions", tags=["export"])


@router.get("/{upload_id}/export/excel")
def export_excel(upload_id: int, db: Session = Depends(get_db)):
    kpi_results = _get_kpi_results(upload_id, db)
    from export.excel_export import generate as excel_generate

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.close()
    excel_generate(kpi_results, tmp.name)
    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"dashboard_{upload_id}.xlsx",
        background=_cleanup(tmp.name),
    )


@router.get("/{upload_id}/export/pptx")
def export_pptx(upload_id: int, db: Session = Depends(get_db)):
    kpi_results = _get_kpi_results(upload_id, db)
    from export.pptx_export import generate as pptx_generate

    tmp = tempfile.NamedTemporaryFile(suffix=".pptx", delete=False)
    tmp.close()
    pptx_generate(kpi_results, tmp.name)
    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"dashboard_{upload_id}.pptx",
        background=_cleanup(tmp.name),
    )


def _get_kpi_results(upload_id: int, db: Session) -> dict:
    upload = db.query(Upload).filter(Upload.id == upload_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    recipe = db.query(ReportRecipe).filter(ReportRecipe.upload_id == upload_id).first()
    if not recipe or not recipe.computed_kpis:
        raise HTTPException(404, "No dashboard results available for this upload.")

    return recipe.computed_kpis


def _cleanup(path: str):
    """Return a background task that deletes the temp file after the response is sent."""
    from starlette.background import BackgroundTask
    return BackgroundTask(os.unlink, path)
