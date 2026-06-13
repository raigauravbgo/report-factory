import json
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from db.database import (
    create_report,
    create_review_entry,
    get_kpi_catalog,
    get_report,
    get_review_queue,
    get_schema_memory,
    list_reports,
    save_schema_memory,
    set_kpi_reviewed,
    update_report,
    update_review_entry,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])

_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "local_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _client_id(x_client_id: str = Header(default="dev")) -> str:
    return x_client_id


# ── Report lifecycle ──────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_new_report(created_by: str = "dev"):
    request_id = str(uuid.uuid4())
    report = create_report(request_id, created_by=created_by)
    return report


@router.get("")
def get_reports(created_by: str | None = None):
    return list_reports(created_by=created_by)


@router.get("/{request_id}")
def get_report_by_id(request_id: str):
    report = get_report(request_id)
    if not report:
        raise HTTPException(404, f"Report '{request_id}' not found.")
    return report


@router.post("/{request_id}/upload")
async def upload_file(request_id: str, file: UploadFile = File(...)):
    report = get_report(request_id)
    if not report:
        raise HTTPException(404, f"Report '{request_id}' not found.")

    allowed = {".xlsx", ".csv"}
    filename = file.filename or "upload"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .xlsx or .csv.")

    dest_dir = _UPLOAD_DIR / request_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / filename

    contents = await file.read()
    dest_path.write_bytes(contents)

    update_report(request_id, file_path=str(dest_path), status="awaiting_discovery")

    return {"file_path": str(dest_path), "filename": filename, "size_bytes": len(contents)}


@router.post("/{request_id}/confirm-mapping")
def confirm_mapping(request_id: str, body: dict):
    """
    Accept or override the auto-generated column mapping.
    Body: {"mapping": {kpi_id: {"numerator_column": str, "denominator_column": str}}}
    """
    report = get_report(request_id)
    if not report:
        raise HTTPException(404, f"Report '{request_id}' not found.")

    incoming: dict = body.get("mapping", {})
    current: dict = report.get("column_mapping") or {}
    merged = {**current, **incoming}

    update_report(request_id, column_mapping=merged, status="mapping_confirmed")
    return {"status": "mapping_confirmed", "column_mapping": merged}


@router.get("/{request_id}/dashboard")
def get_dashboard(request_id: str):
    report = get_report(request_id)
    if not report:
        raise HTTPException(404, f"Report '{request_id}' not found.")
    if report["status"] not in ("computed", "review", "approved"):
        raise HTTPException(
            409,
            f"Dashboard not ready. Current status: {report['status']}. "
            "Complete the agent pipeline first.",
        )
    return {
        "request_id": request_id,
        "template_type": report["template_type"],
        "client_id": report["client_id"],
        "period_start": report["period_start"],
        "period_end": report["period_end"],
        "computed_kpis": report["computed_kpis"],
        "data_quality_flags": report["data_quality_flags"],
    }


# ── Review queue ──────────────────────────────────────────────────────────────

@router.get("/review-queue/list")
def list_review_queue(status: str | None = "pending"):
    return get_review_queue(status=status)


@router.post("/review-queue/{entry_id}/approve")
def approve_review(entry_id: str, body: dict | None = None):
    """
    Approve a report in the review queue.

    Optional body fields:
    - overrides: {kpi_id: new_value} — override specific computed KPI values before publishing
    - reviewer_notes: str
    - promote_kpis: list[str] — kpi_ids to formally add to the catalog (set reviewed=true).
      Use this for any user-defined KPIs that the central data team has validated.
    """
    body = body or {}
    overrides: dict = body.get("overrides", {})
    reviewer_notes: str = body.get("reviewer_notes", "")
    promote_kpis: list[str] = body.get("promote_kpis", [])

    update_review_entry(entry_id, status="approved", reviewer_notes=reviewer_notes, overrides=overrides)

    # Promote user-defined KPIs to reviewed status
    promoted: list[str] = []
    for kpi_id in promote_kpis:
        set_kpi_reviewed(kpi_id, reviewed=True)
        promoted.append(kpi_id)

    # Find the report and save schema memory
    queue = get_review_queue(status=None)
    entry = next((e for e in queue if e["id"] == entry_id), None)
    if entry:
        request_id = entry["request_id"]
        report = get_report(request_id)
        if report:
            mapping = report.get("column_mapping") or {}
            save_schema_memory(
                client_id=report.get("client_id", "unknown"),
                template_type=report.get("template_type", "unknown"),
                mappings=mapping,
                approved_by="reviewer",
            )
            update_report(request_id, status="approved")

    result: dict = {"status": "approved", "entry_id": entry_id}
    if promoted:
        result["promoted_kpis"] = promoted
        result["note"] = f"{len(promoted)} KPI(s) added to the catalog: {promoted}"
    return result


@router.post("/review-queue/{entry_id}/reject")
def reject_review(entry_id: str, body: dict | None = None):
    body = body or {}
    reviewer_notes: str = body.get("reviewer_notes", "")
    update_review_entry(entry_id, status="rejected", reviewer_notes=reviewer_notes)

    queue = get_review_queue(status=None)
    entry = next((e for e in queue if e["id"] == entry_id), None)
    if entry:
        update_report(entry["request_id"], status="rejected")

    return {"status": "rejected", "entry_id": entry_id}


# ── Review queue — new KPI inspection ────────────────────────────────────────

@router.get("/review-queue/{entry_id}/new-kpis")
def get_new_kpis_for_review(entry_id: str):
    """
    Returns any user-defined (unreviewed) KPIs that were created as part of this report.
    Reviewers use this to decide which KPIs to promote to the catalog.
    """
    queue = get_review_queue(status=None)
    entry = next((e for e in queue if e["id"] == entry_id), None)
    if not entry:
        raise HTTPException(404, f"Review entry '{entry_id}' not found.")

    report = get_report(entry["request_id"])
    if not report:
        return {"new_kpis": []}

    intake_spec = report.get("intake_spec") or {}
    kpi_list: list[str] = intake_spec.get("kpi_list", [])

    all_kpis = {k["kpi_id"]: k for k in get_kpi_catalog()}
    new_kpis = [all_kpis[k] for k in kpi_list if k in all_kpis and not all_kpis[k]["reviewed"]]

    return {"new_kpis": new_kpis, "count": len(new_kpis)}


# ── Schema memory ─────────────────────────────────────────────────────────────

@router.get("/{request_id}/schema-memory")
def check_schema_memory(request_id: str):
    report = get_report(request_id)
    if not report:
        raise HTTPException(404, f"Report '{request_id}' not found.")

    client_id = report.get("client_id")
    template_type = report.get("template_type")
    if not client_id or not template_type:
        return {"exists": False}

    memory = get_schema_memory(client_id, template_type)
    if memory:
        return {"exists": True, "schema_memory": memory}
    return {"exists": False}
