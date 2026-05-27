from fastapi import APIRouter, HTTPException, Query

from db.database import create_kpi, get_kpi_by_id, get_kpi_catalog, set_kpi_reviewed

router = APIRouter(prefix="/api/kpis", tags=["kpis"])


@router.get("")
def list_kpis(
    domain: str = Query(None, description="Filter by domain (collections | cx | sales | workforce | ops)"),
    reviewed: bool | None = Query(None, description="Filter by reviewed status"),
):
    kpis = get_kpi_catalog(domain=domain)
    if reviewed is not None:
        kpis = [k for k in kpis if k["reviewed"] == reviewed]
    return kpis


@router.get("/{kpi_id}")
def get_kpi(kpi_id: str):
    kpi = get_kpi_by_id(kpi_id)
    if not kpi:
        raise HTTPException(404, f"KPI '{kpi_id}' not found in catalog.")
    return kpi


@router.post("", status_code=201)
def create_kpi_endpoint(body: dict):
    """
    Manually create a KPI definition. Used by the review team to add KPIs outside the agent flow.
    Required fields: kpi_id, display_name, numerator, denominator, format, domain.
    """
    required = ["kpi_id", "display_name", "numerator", "denominator", "format", "domain"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        raise HTTPException(422, f"Missing required fields: {missing}")

    if get_kpi_by_id(body["kpi_id"]):
        raise HTTPException(409, f"KPI '{body['kpi_id']}' already exists.")

    kpi = create_kpi(body)
    return kpi


@router.post("/{kpi_id}/review")
def review_kpi(kpi_id: str, body: dict | None = None):
    """
    Mark a user-defined KPI as reviewed (reviewed=true) or un-review it (reviewed=false).
    Called by the central data team after validating a new KPI definition.
    Body: {"reviewed": true}  (defaults to true)
    """
    kpi = get_kpi_by_id(kpi_id)
    if not kpi:
        raise HTTPException(404, f"KPI '{kpi_id}' not found.")

    approved = (body or {}).get("reviewed", True)
    set_kpi_reviewed(kpi_id, reviewed=approved)
    return {"kpi_id": kpi_id, "reviewed": approved}
