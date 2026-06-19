"""
Session-aware dimension listing tool for the ADK agent.

Returns the dimension columns for a dataset using the same 4-branch
star-schema priority logic as GET /session/{dataset_id}/dimensions.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

_DIM_EXCLUDED_TAGS = frozenset({"entity_key", "time_key", "financial_metric"})


def run_session_dimensions(dataset_id: int) -> dict:
    """
    Returns dimension columns for a multi-file session using the 4-branch
    star-schema priority: virtual_dimension → dimension tables → shared columns → fallback.

    Call this AFTER run_session_kpi_suggest, once the user has confirmed KPIs.
    Present the list to the user and let them deselect any dimensions they don't want.
    The first dimension in the list is used as the primary breakdown dimension.

    Args:
        dataset_id: The dataset ID from the [DATASET UPLOADED] context block.

    Returns:
        Dict with:
          - status: "dimensions_ready"
          - branch: which priority branch was used
          - dimensions: list of dicts (name, unique_count, sample_values, table_count)
          - message: human-readable summary for the agent to present
    """
    from core.database import SessionLocal
    from models.staging_table import StagingTable
    from models.upload import Upload
    from services.observability import create_trace_event

    run_id = f"session_{dataset_id}"
    create_trace_event(
        run_id=run_id, step_name="dimensions", skill_name="run_session_dimensions",
        status="pending", message="Resolving dimension columns via star-schema priority",
        evidence_json={"dataset_id": dataset_id},
    )

    db = SessionLocal()
    try:
        staging_rows = (
            db.query(StagingTable)
            .join(Upload, StagingTable.upload_id == Upload.id)
            .filter(Upload.dataset_id == dataset_id)
            .all()
        )
        if not staging_rows:
            create_trace_event(
                run_id=run_id, step_name="dimensions", skill_name="run_session_dimensions",
                status="error", message="No staging tables found for dataset",
                evidence_json={"dataset_id": dataset_id},
            )
            return {"error": f"No staging data found for dataset_id={dataset_id}"}

        # ── Build global cross-table column index ────────────────────────────
        col_index: dict[str, dict] = {}
        virtual_dim_stagings = []
        real_dim_stagings = []

        for st in staging_rows:
            if not st.profile_data:
                continue
            table_type = st.profile_data.get("table_type", "unknown")
            if table_type == "virtual_dimension":
                virtual_dim_stagings.append(st)
            elif table_type == "dimension":
                real_dim_stagings.append(st)

            for col in st.profile_data.get("columns", []):
                if col.get("suggested_role") != "dimension":
                    continue
                if col.get("semantic_tag") in _DIM_EXCLUDED_TAGS:
                    continue
                cname = col["name"]
                ucount = col.get("unique_count", 0)
                if cname not in col_index:
                    col_index[cname] = {
                        "count": 0,
                        "best_unique": ucount,
                        "best_samples": [str(v) for v in (col.get("sample_values") or [])[:5]],
                        "best_file": st.upload.filename,
                        "semantic_tag": col.get("semantic_tag") or None,
                    }
                col_index[cname]["count"] += 1
                if ucount > col_index[cname]["best_unique"]:
                    col_index[cname]["best_unique"] = ucount
                    col_index[cname]["best_samples"] = [str(v) for v in (col.get("sample_values") or [])[:5]]
                    col_index[cname]["best_file"] = st.upload.filename

        def _build_result(names: set) -> list[dict]:
            result = []
            for name in names:
                if name not in col_index:
                    continue
                info = col_index[name]
                result.append({
                    "name": name,
                    "unique_count": info["best_unique"],
                    "sample_values": info["best_samples"],
                    "table_count": info["count"],
                    "source_file": "multiple" if info["count"] > 1 else info["best_file"],
                })
            result.sort(key=lambda d: (-d["table_count"], d["name"]))
            return result

        # ── Branch 1: virtual_dimension tables ───────────────────────────────
        if virtual_dim_stagings:
            candidates: set[str] = set()
            for st in virtual_dim_stagings:
                for col in st.profile_data.get("columns", []):
                    if col.get("suggested_role") == "dimension" and col.get("semantic_tag") not in _DIM_EXCLUDED_TAGS:
                        candidates.add(col["name"])
            if candidates:
                dims = _build_result(candidates)
                return _response(dims, "virtual_dimension", run_id)

        # ── Branch 2: regular dimension tables ───────────────────────────────
        if real_dim_stagings:
            candidates = set()
            for st in real_dim_stagings:
                for col in st.profile_data.get("columns", []):
                    if col.get("suggested_role") == "dimension" and col.get("semantic_tag") not in _DIM_EXCLUDED_TAGS:
                        candidates.add(col["name"])
            if candidates:
                dims = _build_result(candidates)
                return _response(dims, "dimension_tables", run_id)

        # ── Branch 3: shared columns (≥ 2 tables) ───────────────────────────
        shared = {name for name, info in col_index.items() if info["count"] >= 2}
        if shared:
            dims = _build_result(shared)
            return _response(dims, "shared_columns", run_id)

        # ── Branch 4: fallback — all dimension-role columns ──────────────────
        dims = _build_result(set(col_index.keys()))
        return _response(dims, "fallback_all", run_id)

    finally:
        db.close()


def _response(dims: list[dict], branch: str, run_id: str = "") -> dict:
    from services.observability import create_trace_event as _trace

    if not dims:
        if run_id:
            _trace(
                run_id=run_id, step_name="dimensions", skill_name="run_session_dimensions",
                status="warning", message="No dimension columns found",
                evidence_json={"branch": branch},
                requires_review=True,
            )
        return {
            "status": "no_dimensions_found",
            "branch": branch,
            "dimensions": [],
            "message": (
                "No dimension columns were found. This can happen when all uploaded files "
                "contain only numeric/date columns. You may proceed with run_session_generate "
                "using an empty dimensions list."
            ),
        }

    top_names = [d["name"] for d in dims[:8]]
    if run_id:
        _trace(
            run_id=run_id, step_name="dimensions", skill_name="run_session_dimensions",
            status="success",
            confidence=1.0,
            message=f"Found {len(dims)} dimensions via branch '{branch}'",
            evidence_json={
                "branch": branch,
                "dimension_count": len(dims),
                "top_dimensions": top_names,
            },
        )
    return {
        "status": "dimensions_ready",
        "branch": branch,
        "count": len(dims),
        "dimensions": dims,
        "message": (
            f"Found {len(dims)} dimension column(s) (source: {branch}). "
            f"Top dimensions: {', '.join(top_names)}. "
            "Present this list to the user. Let them deselect any they don't want. "
            "The first confirmed dimension becomes the primary breakdown dimension. "
            "Once the user has confirmed, call run_session_generate."
        ),
    }
