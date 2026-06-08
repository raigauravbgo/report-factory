"""
Frontend event log endpoint.
Receives fire-and-forget POST from the browser and writes to app.log.
Always returns 200 so a logging failure never breaks the UI.
"""
import logging

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/log", tags=["log"])


class FrontendEvent(BaseModel):
    event: str
    page: str
    data: dict = {}
    dataset_id: int | None = None
    recipe_id: int | None = None
    ts: str = ""


@router.post("/event")
def log_frontend_event(body: FrontendEvent):
    # Build a compact key=value string from the data dict
    detail = " ".join(f"{k}={v!r}" for k, v in body.data.items() if v is not None and v != "")
    ctx = ""
    if body.dataset_id is not None:
        ctx += f" dataset_id={body.dataset_id}"
    if body.recipe_id is not None:
        ctx += f" recipe_id={body.recipe_id}"
    logger.info("FRONTEND | %-35s page=%-12s%s %s", body.event, body.page, ctx, detail)
    return {"ok": True}
