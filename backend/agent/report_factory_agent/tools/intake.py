import json
import sys
from pathlib import Path

# Allow imports from backend root when running via adk web
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import get_kpi_catalog, update_report

VALID_TEMPLATES = [
    "client_health_dashboard",
    "wbr_qbr",
    "exec_scorecard",
    "kpi_spotlight",
]


def run_intake(
    request_id: str,
    template_type: str,
    client_id: str,
    period_start: str,
    period_end: str,
    kpi_list: list[str],
) -> dict:
    """
    Validates and stores the intake specification once the user has confirmed
    all required fields: template type, client, period, and KPI list.

    Args:
        request_id: The report request ID (created by POST /api/reports/).
        template_type: One of client_health_dashboard | wbr_qbr | exec_scorecard | kpi_spotlight.
        client_id: Client identifier string (used as schema memory key).
        period_start: Start date in YYYY-MM-DD format.
        period_end: End date in YYYY-MM-DD format.
        kpi_list: List of kpi_id values from the catalog.

    Returns:
        Confirmed intake_spec dict, or error dict if validation fails.
    """
    if template_type not in VALID_TEMPLATES:
        return {"error": f"Unknown template '{template_type}'. Choose from: {VALID_TEMPLATES}"}

    catalog = get_kpi_catalog()
    catalog_map = {k["kpi_id"]: k for k in catalog}

    # Hard error only for KPIs that truly don't exist — not for unreviewed (user-defined) ones.
    # If a KPI is missing, call run_define_new_kpi first to create it, then retry intake.
    missing_kpis = [k for k in kpi_list if k not in catalog_map]
    if missing_kpis:
        return {
            "error": (
                f"KPI IDs not found in catalog: {missing_kpis}. "
                "Call run_define_new_kpi for each missing KPI to create a definition, "
                "then call run_intake again."
            )
        }

    # Separate already-reviewed KPIs from user-defined (pending review) ones
    unreviewed = [k for k in kpi_list if not catalog_map[k].get("reviewed", False)]

    intake_spec = {
        "template_type": template_type,
        "client_id": client_id,
        "period_start": period_start,
        "period_end": period_end,
        "kpi_list": kpi_list,
        "data_source": "excel_upload",
    }

    update_report(
        request_id,
        template_type=template_type,
        client_id=client_id,
        period_start=period_start,
        period_end=period_end,
        intake_spec=intake_spec,
        status="awaiting_upload",
    )

    result: dict = {"status": "intake_complete", "intake_spec": intake_spec}
    if unreviewed:
        result["unreviewed_kpis"] = unreviewed
        result["note"] = (
            f"{len(unreviewed)} KPI(s) are user-defined and pending central data team review: "
            f"{unreviewed}. They will appear in the review queue alongside the report."
        )
    return result
