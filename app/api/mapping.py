from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agent import orchestrator

router = APIRouter(tags=["mapping"])


class MappingUpdate(BaseModel):
    columns: dict


@router.get("/registry/columns")
async def get_registry_columns():
    """Return all canonical column names known to the KPI registry."""
    return {"columns": orchestrator.get_canonical_columns()}


@router.get("/sessions/{session_id}/mapping")
async def get_mapping(session_id: str):
    try:
        state = orchestrator.get_state(session_id)
        return state["mapping"]
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


@router.post("/sessions/{session_id}/mapping/confirm")
async def confirm_mapping(session_id: str, body: MappingUpdate):
    try:
        return orchestrator.confirm_mapping(session_id, body.columns)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
