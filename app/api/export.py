from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.agent import orchestrator
from app.config import settings
from app.export import excel_export, pptx_export

router = APIRouter(tags=["export"])


@router.get("/sessions/{session_id}/export/excel")
async def export_excel(session_id: str):
    try:
        state = orchestrator.get_state(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if state["analysis"]["status"] != "complete":
        raise HTTPException(status_code=400, detail="Analysis not yet complete")

    out = Path(settings.session_storage_path) / session_id / "exports" / "dashboard.xlsx"
    excel_export.generate(state["analysis"]["kpi_results"], str(out))
    return FileResponse(
        str(out),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="dashboard.xlsx",
    )


@router.get("/sessions/{session_id}/export/pptx")
async def export_pptx(session_id: str):
    try:
        state = orchestrator.get_state(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if state["analysis"]["status"] != "complete":
        raise HTTPException(status_code=400, detail="Analysis not yet complete")

    out = Path(settings.session_storage_path) / session_id / "exports" / "dashboard.pptx"
    pptx_export.generate(state["analysis"]["kpi_results"], str(out))
    return FileResponse(
        str(out),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="dashboard.pptx",
    )
