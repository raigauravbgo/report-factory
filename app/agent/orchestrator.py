"""Session lifecycle and pipeline orchestration."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from app.agent import schema_inference
from app.config import settings
from app.kpi_registry.registry import KPIRegistry
from app.medallion import bronze, silver, gold

_registry = KPIRegistry()

_EMPTY_STATE = {
    "status": "uploading",
    "files": [],
    "mapping": {"confirmed": False, "columns": {}},
    "data_quality": {"checked": False, "available_kpis": [], "blocked_kpis": []},
    "analysis": {"status": "pending", "kpi_results": {}},
}


def create_session() -> str:
    session_id = str(uuid.uuid4())
    session_path = Path(settings.session_storage_path) / session_id
    for sub in ("bronze", "silver", "gold", "exports"):
        (session_path / sub).mkdir(parents=True, exist_ok=True)
    state = {**_EMPTY_STATE, "session_id": session_id}
    _save_state(session_id, state)
    return session_id


def process_upload(
    session_id: str, file_path: str, file_type: str, original_name: str
) -> dict:
    """Ingest a file into the bronze layer and run AI schema inference."""
    state = _load_state(session_id)

    bronze_result = bronze.ingest(file_path, file_type)

    mapping: dict = {}
    if settings.openai_api_key:
        try:
            mapping = schema_inference.infer_column_mapping(
                bronze_result["columns"],
                bronze_result["sample"],
                known_canonical_names=_registry.get_all_canonical_names(),
            )
        except Exception:
            mapping = _fallback_mapping(bronze_result["columns"])
    else:
        mapping = _fallback_mapping(bronze_result["columns"])

    state["mapping"]["columns"].update(mapping)
    state["files"].append(
        {
            "filename": original_name,
            "stored_path": file_path,
            "file_type": file_type,
            "rows": bronze_result["row_count"],
            "columns": bronze_result["column_count"],
        }
    )
    state["status"] = "mapping"
    _save_state(session_id, state)

    return {
        "mapping": mapping,
        "bronze_meta": {k: v for k, v in bronze_result.items() if k != "dataframe"},
    }


def confirm_mapping(session_id: str, updated_mapping: dict) -> dict:
    """Lock in the column mapping and evaluate KPI feasibility."""
    state = _load_state(session_id)
    state["mapping"]["columns"] = updated_mapping
    state["mapping"]["confirmed"] = True

    # Collect confirmed canonical names; also resolve any that are still synonyms
    canonical_cols = [
        _registry.resolve(info["canonical_name"])
        for info in updated_mapping.values()
        if info.get("status") != "ignored" and info.get("canonical_name")
    ]

    feasibility = _registry.evaluate_feasibility(canonical_cols)
    state["data_quality"] = {
        "checked": True,
        "available_kpis": feasibility["available"],
        "blocked_kpis": feasibility["blocked"],
    }
    state["status"] = "ready"
    _save_state(session_id, state)
    return state["data_quality"]


def run_analysis(session_id: str, selected_kpi_ids: list[str]) -> None:
    """Execute the bronze → silver → gold pipeline synchronously (called as a background task)."""
    state = _load_state(session_id)
    state["analysis"]["status"] = "running"
    _save_state(session_id, state)

    try:
        silver_frames: dict[str, dict] = {}
        for file_info in state["files"]:
            b = bronze.ingest(file_info["stored_path"], file_info["file_type"])
            s = silver.clean(b["dataframe"], state["mapping"]["columns"], registry=_registry)
            silver_frames[file_info["file_type"]] = s

        kpi_results = gold.compute(silver_frames, selected_kpi_ids, _registry)
        state["analysis"] = {"status": "complete", "kpi_results": kpi_results}
        state["status"] = "complete"
    except Exception as exc:
        state["analysis"] = {"status": "error", "error": str(exc)}

    _save_state(session_id, state)


def get_state(session_id: str) -> dict:
    return _load_state(session_id)


def get_canonical_columns() -> list[str]:
    return _registry.get_all_canonical_names()


def _save_state(session_id: str, state: dict) -> None:
    path = Path(settings.session_storage_path) / session_id / "state.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, default=str)


def _load_state(session_id: str) -> dict:
    path = Path(settings.session_storage_path) / session_id / "state.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _fallback_mapping(columns: list[str]) -> dict:
    """Produce a simple review_needed mapping when Claude is unavailable."""
    return {
        col: {
            "canonical_name": col.lower().replace(" ", "_"),
            "confidence": 0.5,
            "status": "review_needed",
            "reasoning": "Auto-generated fallback — no AI key configured",
        }
        for col in columns
    }
