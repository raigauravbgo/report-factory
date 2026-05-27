from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.agent import orchestrator

router = APIRouter(tags=["analysis"])


class AnalysisRequest(BaseModel):
    kpi_ids: list[str]


@router.post("/sessions/{session_id}/analyze")
async def run_analysis(
    session_id: str, body: AnalysisRequest, background_tasks: BackgroundTasks
):
    try:
        orchestrator.get_state(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    background_tasks.add_task(orchestrator.run_analysis, session_id, body.kpi_ids)
    return {"status": "started", "session_id": session_id}


@router.get("/sessions/{session_id}/status")
async def get_status(session_id: str):
    try:
        state = orchestrator.get_state(session_id)
        return {
            "session_id": session_id,
            "status": state["status"],
            "analysis_status": state["analysis"]["status"],
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


@router.get("/sessions/{session_id}/dashboard")
async def get_dashboard(session_id: str):
    try:
        state = orchestrator.get_state(session_id)
        if state["analysis"]["status"] != "complete":
            raise HTTPException(status_code=400, detail="Analysis not yet complete")
        return {
            "session_id": session_id,
            "kpi_results": state["analysis"]["kpi_results"],
            "data_quality": state["data_quality"],
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
