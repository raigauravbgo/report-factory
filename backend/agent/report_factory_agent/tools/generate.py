import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import (
    create_review_entry,
    get_kpi_catalog,
    get_report,
    log_agent_step,
    update_report,
)

_TEMPLATES_DIR = Path(__file__).resolve().parents[3] / "catalog" / "templates"


def _load_template(template_type: str) -> dict:
    path = _TEMPLATES_DIR / f"{template_type}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def run_generate(request_id: str) -> dict:
    """
    Builds chart-ready JSON from computed KPIs and the template chart config,
    creates a PPTX placeholder, and submits the report to the review queue.

    Args:
        request_id: The report request ID.

    Returns:
        Dict with dashboard_data (chart configs + KPI values) and review_queue_id.
    """
    t0 = time.time()
    report = get_report(request_id)
    if not report:
        return {"error": f"Report {request_id} not found."}

    computed_kpis: dict = report.get("computed_kpis") or {}
    intake_spec: dict = report.get("intake_spec") or {}
    flags: list = report.get("data_quality_flags") or []

    template_type = intake_spec.get("template_type", "kpi_spotlight")
    template = _load_template(template_type)

    catalog = {k["kpi_id"]: k for k in get_kpi_catalog()}

    # Build chart data: one entry per chart in the template
    charts: list[dict] = []
    for chart_cfg in template.get("charts", []):
        kpi_id = chart_cfg.get("kpi") or ""
        kpis = chart_cfg.get("kpis", [kpi_id] if kpi_id else [])
        chart_data: dict = {
            "chart_id": chart_cfg["chart_id"],
            "type": chart_cfg["type"],
            "title": chart_cfg["title"],
            "x_axis": chart_cfg.get("x_axis", "date"),
            "y_format": chart_cfg.get("y_format", "percentage"),
            "series": [],
        }
        for kid in kpis:
            if kid in computed_kpis:
                kpi_meta = catalog.get(kid, {})
                chart_data["series"].append({
                    "kpi_id": kid,
                    "display_name": kpi_meta.get("display_name", kid),
                    "value": computed_kpis[kid].get("value"),
                    "format": kpi_meta.get("format", "percentage"),
                    "flags": computed_kpis[kid].get("flags", []),
                })
        charts.append(chart_data)

    # KPI tile summary (all computed KPIs)
    kpi_tiles: list[dict] = []
    for kpi_id, result in computed_kpis.items():
        meta = catalog.get(kpi_id, {})
        kpi_tiles.append({
            "kpi_id": kpi_id,
            "display_name": meta.get("display_name", kpi_id),
            "value": result.get("value"),
            "format": meta.get("format", "percentage"),
            "flags": result.get("flags", []),
        })

    dashboard_data: dict = {
        "template_type": template_type,
        "client_id": intake_spec.get("client_id"),
        "period_start": intake_spec.get("period_start"),
        "period_end": intake_spec.get("period_end"),
        "kpi_tiles": kpi_tiles,
        "charts": charts,
        "data_quality_flags": flags,
    }

    # Create review queue entry
    review_id = str(uuid.uuid4())
    create_review_entry(review_id, request_id)

    latency_ms = int((time.time() - t0) * 1000)
    update_report(request_id, status="review")
    log_agent_step(request_id, "generate", {"template_type": template_type}, dashboard_data, latency_ms)

    return {
        "status": "generate_complete",
        "dashboard_data": dashboard_data,
        "review_queue_id": review_id,
        "pptx_path": None,  # placeholder — python-pptx export wired up in Week 2
        "message": f"Report submitted to review queue (id: {review_id}). A reviewer will approve or reject it.",
    }
