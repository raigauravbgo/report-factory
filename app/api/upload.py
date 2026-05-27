import json
import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.agent import orchestrator
from app.config import settings

router = APIRouter(tags=["upload"])


@router.post("/sessions")
async def create_session_and_upload(
    files: List[UploadFile] = File(...),
    file_types: str = Form(...),
):
    types = json.loads(file_types)
    session_id = orchestrator.create_session()

    upload_dir = Path(settings.upload_storage_path) / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for i, file in enumerate(files):
        dest = upload_dir / file.filename
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
        file_type = types[i] if i < len(types) else "unknown"
        result = orchestrator.process_upload(session_id, str(dest), file_type, file.filename)
        results.append(result)

    return {
        "session_id": session_id,
        "files_processed": len(results),
        "mapping_suggestions": results,
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    try:
        return orchestrator.get_state(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
