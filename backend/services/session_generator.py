"""
Generates a ReportRecipe from a full session (multi-file, selected KPIs, relationships).
Called by POST /session/{dataset_id}/generate.
"""
from __future__ import annotations

import json
import logging
import re

from sqlalchemy.orm import Session as DbSession

from models.report_recipe import ReportRecipe
from models.upload import Upload
from services.ai_client import chat_complete

logger = logging.getLogger(__name__)


def generate_from_session(
    dataset_id: int,
    selected_kpis: list[dict],
    confirmed_relationships: list[dict],
    interview_result: dict,
    db: DbSession,
) -> int:
    """Build a RecipeConfig with story-driven sections and persist it. Returns recipe_id."""
    from models.staging_table import StagingTable

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    upload_id = uploads[0].id if uploads else 0
    # H19: Use actual client_id from upload — "default" breaks schema memory keyed on client_id
    client_id = uploads[0].client_id if uploads else "default"
    # Fix 3: persist all upload IDs so the dashboard never silently drops to first-file mode
    all_upload_ids = [u.id for u in uploads]

    # Fix 2a: build filename → staging table name map.
    # The compute engine needs this to resolve `file_a`/`file_b` names from
    # confirmed_relationships (which use filenames) back to physical table names.
    upload_table_map: dict[str, str] = {}
    for _u in uploads:
        _umap_st = db.query(StagingTable).filter(StagingTable.upload_id == _u.id).first()
        if _umap_st:
            upload_table_map[_u.filename] = _umap_st.table_name

    # Use the formula already resolved by kpi_suggester (actual column names), falling back to display_name
    resolved_kpis = [
        {
            "name": kpi.get("display_name") or kpi.get("kpi_id", ""),
            "formula": kpi.get("formula", ""),
            "domain": kpi.get("domain", ""),
            "aggregation": kpi.get("aggregation", ""),
            "format": kpi.get("format", ""),
        }
        for kpi in selected_kpis
    ]

    # ── Step 1: Read schema-mapped filters — highest authority ────────────────
    # Columns the user explicitly flagged as filters in the Schema Mapping step.
    # These always take precedence; they replace (not merge into) whatever the
    # interview or heuristic might have returned.
    schema_filters: list[str] = []
    for upload in uploads:
        _st = db.query(StagingTable).filter(StagingTable.upload_id == upload.id).first()
        if _st and _st.profile_data:
            for col in _st.profile_data.get("columns", []):
                if col.get("is_filter") and col["name"] not in schema_filters:
                    schema_filters.append(col["name"])

    # ── Step 2: Interview result — date/dims/granularity/domain ────────────
    cols: set[str] = set()
    date_col = interview_result.get("date_column") or ""
    dimensions = list(interview_result.get("dimensions") or [])
    granularity = interview_result.get("granularity") or "monthly"
    domain = interview_result.get("domain") or ""

    # ── Step 3: Per-field heuristic fallback for date/dims only ────────────
    # Filters are NOT filled by heuristic — user intent is respected:
    # schema filters → interview filters → empty (no arbitrary injection).
    if not date_col or not dimensions:
        from services.ai_interview import default_interview_result as _heuristic
        _heuristic_profiles = []
        for _u in uploads:
            _st2 = db.query(StagingTable).filter(StagingTable.upload_id == _u.id).first()
            if _st2 and _st2.profile_data:
                _heuristic_profiles.append({**_st2.profile_data, "filename": _u.filename})
        if _heuristic_profiles:
            _hr = _heuristic(_heuristic_profiles)
            if not date_col:
                date_col = _hr.get("date_column") or ""
            if not dimensions:
                dimensions = list(_hr.get("dimensions") or [])
            if not granularity or granularity == "monthly":
                granularity = _hr.get("granularity") or "monthly"
            if not domain:
                domain = _hr.get("domain") or ""

    # ── Step 4: Resolve final filter list ─────────────────────────────────
    # Priority: schema_filters > interview_result.filters > [] (no heuristic fallback)
    if schema_filters:
        filters = schema_filters
        logger.info(
            "GENERATE_FROM_SESSION dataset_id=%d filters=schema(%d): %s",
            dataset_id, len(filters), filters,
        )
    else:
        filters = list(interview_result.get("filters") or [])
        logger.info(
            "GENERATE_FROM_SESSION dataset_id=%d filters=interview(%d): %s",
            dataset_id, len(filters), filters,
        )

    # ── Build story sections ───────────────────────────────────────────────
    sections = _build_sections(resolved_kpis, {**interview_result, "domain": domain or "ops"})

    if date_col:
        cols.add(date_col)
    cols.update(dimensions)
    cols.update(filters)
    column_mappings = {c: c for c in sorted(cols)}

    # Chart layout from sections
    chart_layout = _build_chart_layout(sections, dimensions)

    config = {
        "upload_id": upload_id,            # kept for backward compat (primary file)
        "upload_ids": all_upload_ids,      # Fix 3: full list of all files in this session
        "upload_table_map": upload_table_map,  # Fix 2a: filename → staging table name
        "dataset_id": dataset_id,
        "column_mappings": column_mappings,
        "date_column": date_col,
        "granularity": granularity,
        "dimensions": dimensions,
        "filters": filters,
        "kpis": [{"name": k["name"], "formula": k["formula"], "aggregation": k.get("aggregation", ""), "format": k.get("format", "")} for k in resolved_kpis],
        "chart_layout": chart_layout,
        "sections": sections,
        "confirmed_relationships": confirmed_relationships,
    }

    recipe = ReportRecipe(
        client_id=client_id,
        dataset_id=dataset_id,
        config=config,
        version=1,
    )
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe.id


def _build_sections(kpis: list[dict], interview_result: dict) -> list[dict]:
    """Use AI to group KPIs into story-driven sections."""
    kpi_list = "\n".join(
        f"- {k['name']} (formula: {k['formula']}, domain: {k['domain']})" for k in kpis
    )
    domain = interview_result.get("domain") or "unknown"

    prompt = f"""You are a BI analyst. Given these KPIs for a {domain} dashboard:
{kpi_list}

Group them into 2-4 story-driven sections. Each section should have a clear narrative purpose.
Standard sections: Overview, Performance Trends, Breakdown Analysis, Data Quality.
Use only the sections that make sense for these specific KPIs.

Return ONLY valid JSON:
[
  {{
    "id": "overview",
    "title": "Performance Overview",
    "kpis": ["<kpi name>"],
    "chart_type": "kpi_card"
  }}
]
chart_type must be one of: kpi_card, line, bar, table."""

    valid_names = {k["name"] for k in kpis}

    def _filter_sections(sections: list[dict]) -> list[dict]:
        """Remove KPI names the AI hallucinated; drop empty sections."""
        filtered = []
        for s in sections:
            kept = [n for n in s.get("kpis", []) if n in valid_names]
            if kept:
                filtered.append({**s, "kpis": kept})
        return filtered or _fallback_section(kpis)

    try:
        raw = chat_complete([{"role": "user", "content": prompt}], temperature=0.2, json_mode=True)
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return _filter_sections(parsed)
        if isinstance(parsed, dict) and isinstance(parsed.get("sections"), list):
            return _filter_sections(parsed["sections"])
    except Exception:
        pass

    return _fallback_section(kpis)


def _fallback_section(kpis: list[dict]) -> list[dict]:
    return [
        {
            "id": "overview",
            "title": "Dashboard Overview",
            "kpis": [k["name"] for k in kpis],
            "chart_type": "kpi_card",
        }
    ]


def _build_chart_layout(sections: list[dict], dimensions: list[str]) -> list[dict]:
    layout = []
    for section in sections:
        chart_type = section.get("chart_type", "kpi_card")
        for kpi_name in section.get("kpis", []):
            if chart_type == "kpi_card":
                layout.append({"type": "line", "kpi": kpi_name, "title": kpi_name.replace("_", " ").title()})
            else:
                layout.append({"type": chart_type, "kpi": kpi_name, "title": kpi_name.replace("_", " ").title()})
            if dimensions and chart_type in ("bar", "line"):
                layout.append({
                    "type": "bar",
                    "kpi": kpi_name,
                    "title": f"{kpi_name.replace('_', ' ').title()} by {dimensions[0]}",
                    "group_by": dimensions[0],
                })
    return layout
