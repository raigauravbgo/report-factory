"""
Generates a ReportRecipe from a full session (multi-file, selected KPIs, relationships).
Called by POST /session/{dataset_id}/generate.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy.orm import Session as DbSession

from models.report_recipe import ReportRecipe
from models.upload import Upload
from services.ai_client import chat_complete

_CATALOG_PATH = Path(__file__).parent.parent / "catalog" / "kpis.json"
_catalog_cache: list[dict] | None = None


def _load_catalog() -> list[dict]:
    global _catalog_cache
    if _catalog_cache is None:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            _catalog_cache = json.load(f)
    return _catalog_cache


def generate_from_session(
    dataset_id: int,
    selected_kpi_ids: list[str],
    confirmed_relationships: list[dict],
    interview_result: dict,
    db: DbSession,
) -> int:
    """Build a RecipeConfig with story-driven sections and persist it. Returns recipe_id."""
    catalog = _load_catalog()
    kpi_map = {k["kpi_id"]: k for k in catalog}

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    upload_id = uploads[0].id if uploads else 0

    # Resolve selected KPIs
    selected_kpis = []
    for kpi_id in selected_kpi_ids:
        if kpi_id in kpi_map:
            k = kpi_map[kpi_id]
            selected_kpis.append({
                "name": k.get("display_name", kpi_id),
                "formula": f"{k.get('numerator', '?')} / {k.get('denominator', '?')}",
                "domain": k.get("domain", ""),
            })
        else:
            # Custom KPI (source=interview)
            selected_kpis.append({"name": kpi_id, "formula": "", "domain": "custom"})

    # Build story sections via AI
    sections = _build_sections(selected_kpis, interview_result)

    # Build column mappings from interview result
    cols: set[str] = set()
    date_col = interview_result.get("date_column") or ""
    dimensions = interview_result.get("dimensions") or []
    filters = interview_result.get("filters") or []
    granularity = interview_result.get("granularity") or "monthly"

    if date_col:
        cols.add(date_col)
    cols.update(dimensions)
    cols.update(filters)
    column_mappings = {c: c for c in sorted(cols)}

    # Chart layout from sections
    chart_layout = _build_chart_layout(sections, dimensions)

    config = {
        "upload_id": upload_id,
        "dataset_id": dataset_id,
        "column_mappings": column_mappings,
        "date_column": date_col,
        "granularity": granularity,
        "dimensions": dimensions,
        "filters": filters,
        "kpis": [{"name": k["name"], "formula": k["formula"]} for k in selected_kpis],
        "chart_layout": chart_layout,
        "sections": sections,
        "confirmed_relationships": confirmed_relationships,
    }

    recipe = ReportRecipe(
        client_id="default",
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

    try:
        raw = chat_complete([{"role": "user", "content": prompt}], temperature=0.2, json_mode=True)
        # The response might be wrapped in {"sections": [...]} or just a list
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and isinstance(parsed.get("sections"), list):
            return parsed["sections"]
    except Exception:
        pass

    # Fallback: put all KPIs in one overview section
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
