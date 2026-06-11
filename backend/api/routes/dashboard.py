import io
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from core.database import get_db
from models.report_recipe import ReportRecipe
from models.staging_table import StagingTable
from models.upload import Upload
from services.compute import compute_dashboard, get_filter_options

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _get_recipe_and_staging(recipe_id: int, db: Session):
    """Return (recipe, config, primary_staging, all_table_names).

    all_table_names includes every staging table for the dataset so that
    multi-file uploads (e.g. Adherence + CSAT) are concatenated in compute.
    """
    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")
    config = recipe.config
    upload_id = config.get("upload_id")
    dataset_id = config.get("dataset_id")

    # Primary staging table (backward compat — must resolve)
    primary: StagingTable | None = None
    if upload_id:
        primary = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()

    # Collect ALL staging tables for the dataset to support multi-file compute.
    # If dataset_id is present use it; otherwise fall back to single upload.
    # H4: Single JOIN query replaces N+1 (one StagingTable query per upload)
    all_table_names: list[str] = []
    if dataset_id:
        staging_rows = (
            db.query(StagingTable)
            .join(Upload, StagingTable.upload_id == Upload.id)
            .filter(Upload.dataset_id == dataset_id)
            .all()
        )
        all_table_names = [st.table_name for st in staging_rows]

    if not all_table_names and primary:
        all_table_names = [primary.table_name]

    if not primary and all_table_names:
        primary = db.query(StagingTable).filter(
            StagingTable.table_name == all_table_names[0]
        ).first()

    if not primary:
        raise HTTPException(404, "Staging data not found. Re-upload the file.")

    return recipe, config, primary, all_table_names


@router.get("/{recipe_id}/validate-config")
def validate_config(recipe_id: int, db: Session = Depends(get_db)):
    """
    Pre-flight data integrity check: verifies the recipe config works against real data.
    Returns { valid, errors, warnings, details }.
    Used by the recipe editor before approval and by the dashboard on first load.
    """
    recipe, config, _staging, all_table_names = _get_recipe_and_staging(recipe_id, db)
    from services.compute import validate_dashboard_config
    result = validate_dashboard_config(config, all_table_names)
    logger.info(
        "VALIDATE_CONFIG recipe_id=%d valid=%s errors=%d warnings=%d",
        recipe_id, result["valid"], len(result["errors"]), len(result["warnings"]),
    )
    return result


@router.get("/{recipe_id}/filter-values")
def get_dashboard_filter_values(recipe_id: int, db: Session = Depends(get_db)):
    """Return distinct values for each filter column — used to populate FilterBar dropdowns."""
    recipe, config, staging, all_table_names = _get_recipe_and_staging(recipe_id, db)

    # Only show columns explicitly listed as filters; fall back to dimensions if none set.
    filter_cols = config.get("filters") or []
    candidate_cols = filter_cols if filter_cols else config.get("dimensions", [])
    candidate_cols = list(dict.fromkeys(candidate_cols))  # deduplicate, preserve order

    # Exclude entity keys, emails, and text blobs (high-cardinality / PII) from dropdowns.
    # Bug fix: build col_meta from ALL files in the dataset, not just the primary staging table.
    # Columns from files 2+ would otherwise bypass semantic-tag filtering.
    dataset_id = config.get("dataset_id")
    all_col_meta: dict = {}
    if dataset_id:
        all_stagings = (
            db.query(StagingTable)
            .join(Upload, StagingTable.upload_id == Upload.id)
            .filter(Upload.dataset_id == dataset_id)
            .all()
        )
        for _st in all_stagings:
            for _col in (_st.profile_data or {}).get("columns", []):
                all_col_meta[_col["name"]] = _col  # last file wins on name collision
    elif staging.profile_data:
        # fallback for legacy single-file recipes without dataset_id
        for _col in staging.profile_data.get("columns", []):
            all_col_meta[_col["name"]] = _col
    if all_col_meta:
        filtered = [
            c for c in candidate_cols
            if all_col_meta.get(c, {}).get("semantic_tag") not in ("entity_key", "time_key", "text", "ignore")
        ]
        candidate_cols = filtered if filtered else candidate_cols

    # Cap dimension-fallback columns at 5 by unique_count ascending (lowest cardinality = most
    # useful for filtering). Only applies when no explicit filter columns are configured —
    # user-chosen filters are never capped.
    if not filter_cols and len(candidate_cols) > 5:
        def _unique_count(col_name: str) -> int:
            return int(all_col_meta.get(col_name, {}).get("unique_count", 999))
        candidate_cols = sorted(candidate_cols, key=_unique_count)[:5]
        logger.debug("FILTER_BAR_CAP recipe_id=%d capped_dims=%s", recipe_id, candidate_cols)

    try:
        options = get_filter_options(all_table_names, candidate_cols)
    except Exception as e:
        raise HTTPException(500, f"Failed to load filter values: {e}")
    return options


@router.get("/{recipe_id}/data")
def get_dashboard_data(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
    granularity: str = Query(default=None, description="Override recipe granularity: daily | weekly | monthly"),
):
    recipe, config, staging, all_table_names = _get_recipe_and_staging(recipe_id, db)

    # Extract active filters from query params (exclude reserved params)
    reserved = {"recipe_id", "granularity"}
    active_filters = {
        k: v for k, v in request.query_params.items()
        if k not in reserved and v
    }

    # For multi-file recipes generated before the sessionStorage fix, confirmed_relationships
    # may be empty even though detectable JOINs exist.  Auto-infer them at query time so
    # row-level filters produce correct results instead of nulling out all KPI values.
    if (
        active_filters
        and not config.get("confirmed_relationships")
        and len(all_table_names) > 1
        and config.get("dataset_id")
        and config.get("upload_table_map")
    ):
        from services.schema_relationships import infer as _infer_rels
        try:
            inferred = _infer_rels(config["dataset_id"], db)
            pk_fk = [
                {
                    "relationship_type": r.relationship_type,
                    "file_a": r.file_a,
                    "col_a": r.col_a,
                    "file_b": r.file_b,
                    "col_b": r.col_b,
                    "confidence": r.confidence,
                }
                for r in inferred
                if r.relationship_type == "pk_fk" and r.confidence >= 0.7
            ]
            if pk_fk:
                config = {**config, "confirmed_relationships": pk_fk}
                logger.info(
                    "AUTO_REL recipe_id=%d inferred %d pk_fk relationships for filtered query",
                    recipe_id,
                    len(pk_fk),
                )
        except Exception as _e:
            logger.warning("AUTO_REL recipe_id=%d failed to infer: %s", recipe_id, _e)

    t0 = time.perf_counter()
    try:
        result = compute_dashboard(
            config, all_table_names,
            filters=active_filters or None,
            granularity_override=granularity,
        )
    except Exception as e:
        logger.error("COMPUTE_FAIL recipe_id=%d error=%r", recipe_id, str(e))
        raise HTTPException(500, f"Computation failed: {e}")
    logger.info(
        "DASHBOARD_COMPUTE recipe_id=%d kpis=%d blank=%d filters=%s duration=%.2fs",
        recipe_id,
        len(result.get("kpi_summaries", [])),
        sum(1 for k in result.get("kpi_summaries", []) if k.get("value") is None),
        list(active_filters.keys()) if active_filters else [],
        time.perf_counter() - t0,
    )
    effective_granularity = granularity or config.get("granularity", "weekly")
    return {
        "recipe_id": recipe_id,
        "config": {**config, "granularity": effective_granularity},
        "active_filters": active_filters,
        "active_granularity": effective_granularity,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **result,
    }


@router.get("/{recipe_id}/export/excel")
def export_excel(recipe_id: int, db: Session = Depends(get_db)):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    recipe, config, staging, all_table_names = _get_recipe_and_staging(recipe_id, db)
    try:
        result = compute_dashboard(config, all_table_names)
    except Exception as e:
        logger.error("EXPORT_FAIL recipe_id=%d format=excel error=%r", recipe_id, str(e))
        raise HTTPException(500, f"Computation failed: {e}")
    logger.info("DASHBOARD_EXPORT recipe_id=%d format=excel kpis=%d", recipe_id, len(result.get("kpi_summaries", [])))

    wb = openpyxl.Workbook()

    # Sheet 1: KPI Summary
    ws = wb.active
    ws.title = "KPI Summary"
    header_fill = PatternFill("solid", fgColor="3B82F6")
    header_font = Font(bold=True, color="FFFFFF")

    ws.append(["KPI", "Value", "Formula"])
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    for kpi in result["kpi_summaries"]:
        val = kpi["value"]
        if val is not None and "/" in kpi["formula"]:
            val = f"{val * 100:.1f}%"
        elif val is not None:
            val = round(val, 2)
        ws.append([kpi["name"], val, kpi["formula"]])

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 15
    ws.column_dimensions["C"].width = 35

    # Sheet 2: Time Series
    if result["time_series"]:
        ws2 = wb.create_sheet("Time Series")
        for ts in result["time_series"]:
            ws2.append([ts["kpi"]])
            ws2.cell(ws2.max_row, 1).font = Font(bold=True)
            ws2.append(["Date", "Value"])
            for cell in ws2[ws2.max_row]:
                cell.fill = header_fill
                cell.font = header_font
            for point in ts["data"]:
                ws2.append([point["date"], point["value"]])
            ws2.append([])
        ws2.column_dimensions["A"].width = 18
        ws2.column_dimensions["B"].width = 15

    # Sheet 3: Breakdown
    if result["breakdown"]:
        ws3 = wb.create_sheet("Breakdown")
        for bk in result["breakdown"]:
            ws3.append([f"{bk['kpi']} by {bk['dimension']}"])
            ws3.cell(ws3.max_row, 1).font = Font(bold=True)
            ws3.append([bk["dimension"], "Value"])
            for cell in ws3[ws3.max_row]:
                cell.fill = header_fill
                cell.font = header_font
            for point in bk["data"]:
                ws3.append([point["label"], point["value"]])
            ws3.append([])
        ws3.column_dimensions["A"].width = 25
        ws3.column_dimensions["B"].width = 15

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=dashboard_recipe_{recipe_id}.xlsx"},
    )


@router.get("/{recipe_id}/export/pptx")
def export_pptx(recipe_id: int, db: Session = Depends(get_db)):
    from exporters.pptx_exporter import generate_pptx

    recipe, config, staging, all_table_names = _get_recipe_and_staging(recipe_id, db)
    try:
        result = compute_dashboard(config, all_table_names)
    except Exception as e:
        logger.error("EXPORT_FAIL recipe_id=%d format=pptx error=%r", recipe_id, str(e))
        raise HTTPException(500, f"Computation failed: {e}")
    logger.info("DASHBOARD_EXPORT recipe_id=%d format=pptx kpis=%d", recipe_id, len(result.get("kpi_summaries", [])))

    dashboard_data = {
        "template_type": config.get("granularity", ""),
        "client_id": f"Recipe #{recipe_id}",
        "period_start": None,
        "period_end": None,
        "kpi_tiles": [
            {
                "kpi_id": k["name"],
                "display_name": k["name"].replace("_", " ").title(),
                "value": k["value"],
                "format": "percentage" if "/" in k["formula"] else "integer",
                "flags": [],
            }
            for k in result["kpi_summaries"]
        ],
        "charts": [
            {**ts, "type": "line"}
            for ts in result["time_series"]
        ] + [
            {**bk, "type": "bar", "title": f"{bk['kpi']} by {bk['dimension']}"}
            for bk in result["breakdown"]
        ],
        "data_quality_flags": [],
    }

    pptx_bytes = generate_pptx(dashboard_data)
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f"attachment; filename=dashboard_recipe_{recipe_id}.pptx"},
    )


# ── Formula validation ───────────────────────────────────────────────────────

@router.post("/{recipe_id}/validate-formula")
def validate_formula(recipe_id: int, body: dict, db: Session = Depends(get_db)):
    """
    Test-compute a single KPI formula against the recipe's staging data.

    Returns:
      { valid: bool, preview_value: float|null, error: str|null }

    Used by the recipe editor to give per-formula feedback before approval.
    """
    formula = (body.get("formula") or "").strip()
    if not formula:
        raise HTTPException(400, "formula is required")

    recipe, config, _staging, all_table_names = _get_recipe_and_staging(recipe_id, db)

    try:
        from services.compute import (
            _load_staging_df,
            _eval_formula,
            _formula_agg,
        )
        import pandas as pd

        df = _load_staging_df(all_table_names)
        if df.empty:
            return {"valid": False, "preview_value": None,
                    "error": "Staging table is empty — re-upload the file."}

        series = _eval_formula(df, formula)
        if series.empty or series.isna().all():
            return {"valid": False, "preview_value": None,
                    "error": "Formula references unknown or non-numeric columns."}

        agg = _formula_agg(formula)
        raw = series.mean() if agg in ("mean", "ratio") else series.sum()

        if pd.isna(raw):
            return {"valid": False, "preview_value": None,
                    "error": "Formula produces no valid values (all NaN)."}

        return {"valid": True, "preview_value": round(float(raw), 4), "error": None}
    except Exception as exc:
        logger.warning("VALIDATE_FORMULA recipe_id=%d formula=%r error=%r",
                       recipe_id, formula, str(exc))
        return {"valid": False, "preview_value": None, "error": str(exc)}


# ── Recipe config patch ───────────────────────────────────────────────────────

_PATCHABLE_FIELDS = {"granularity", "date_column", "dimensions", "filters", "kpis", "column_mappings"}


@router.patch("/{recipe_id}/config")
def patch_recipe_config(recipe_id: int, body: dict, db: Session = Depends(get_db)):
    """Update mutable recipe config fields without changing approval status.

    Only granularity, date_column, dimensions, filters, kpis, and column_mappings
    are accepted — structural fields (upload_id, dataset_id) are immutable.
    """
    from models.report_recipe import ReportRecipe

    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")

    config = dict(recipe.config)
    updated_fields = []
    for field in _PATCHABLE_FIELDS:
        if field in body:
            config[field] = body[field]
            updated_fields.append(field)

    if not updated_fields:
        raise HTTPException(400, f"No patchable fields found. Allowed: {sorted(_PATCHABLE_FIELDS)}")

    recipe.config = config
    db.commit()
    logger.info("RECIPE_CONFIG_PATCHED recipe_id=%d fields=%s", recipe_id, updated_fields)
    return {"status": "ok", "updated": updated_fields, "config": config}
