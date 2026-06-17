import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from db.database import create_kpi, get_kpi_by_id, get_kpi_catalog, set_kpi_reviewed

logger = logging.getLogger(__name__)

_CATALOG_PATH = Path(__file__).resolve().parent.parent.parent / "catalog" / "kpis.json"

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


# ── Custom KPI Proposals — MUST be declared before /{kpi_id} so FastAPI
#    matches the literal path "/custom" rather than treating it as a parameter.

@router.get("/custom")
def list_custom_kpis(
    status: str = Query("pending", description="Filter by status: pending | approved | rejected | all"),
    db: Session = Depends(get_db),
):
    """List AI-generated custom KPI proposals with their approval status."""
    from models.custom_kpi_proposal import CustomKpiProposal
    q = db.query(CustomKpiProposal)
    if status != "all":
        q = q.filter(CustomKpiProposal.status == status)
    proposals = q.order_by(CustomKpiProposal.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "kpi_id": p.kpi_id,
            "display_name": p.display_name,
            "formula": p.formula,
            "description": p.description or "",
            "domain": p.domain or "",
            "aggregation": p.aggregation or "",
            "format": p.format or "decimal",
            "status": p.status,
            "dataset_id": p.dataset_id,
            "recipe_id": p.recipe_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in proposals
    ]


@router.post("/custom/{proposal_id}/approve")
def approve_custom_kpi(proposal_id: int, body: dict, db: Session = Depends(get_db)):
    """Approve a custom KPI proposal and write it to catalog/kpis.json.

    Body fields:
      formula      : (required) possibly-edited formula before catalog write
      description  : (optional) human-readable description
      aliases      : (optional) list of alternative names
      source_fields: (optional) list of column names — auto-extracted from formula if empty
    """
    from models.custom_kpi_proposal import CustomKpiProposal

    proposal = db.query(CustomKpiProposal).filter(CustomKpiProposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(404, "Custom KPI proposal not found.")
    if proposal.status == "approved":
        raise HTTPException(409, "This KPI proposal is already approved.")

    formula = (body.get("formula") or proposal.formula).strip()
    description = body.get("description") or proposal.description or ""
    aliases: list[str] = body.get("aliases") or []
    source_fields: list[str] = body.get("source_fields") or []

    # Auto-extract source_fields from formula column token names
    if not source_fields:
        _keywords = {"count", "sum", "mean", "avg", "average"}
        source_fields = [
            t for t in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", formula)
            if t.lower() not in _keywords
        ]

    # Build the catalog entry
    entry = {
        "kpi_id": proposal.kpi_id,
        "display_name": proposal.display_name,
        "description": description,
        "formula": formula,
        "format": proposal.format or "decimal",
        "domain": proposal.domain or "ops",
        "aggregation": proposal.aggregation or "sum",
        "expected_range": {"min": 0, "max": 1} if (proposal.format or "").lower() == "percentage" else None,
        "aliases": aliases,
        "source_fields": source_fields,
        "reviewed": True,
    }

    # Write to kpis.json — append if kpi_id not present, update if already there.
    # Keep the original text so we can restore it if the DB commit fails.
    try:
        old_catalog_text = _CATALOG_PATH.read_text(encoding="utf-8")
        catalog: list[dict] = json.loads(old_catalog_text)
        existing_idx = next((i for i, k in enumerate(catalog) if k.get("kpi_id") == proposal.kpi_id), None)
        if existing_idx is not None:
            catalog[existing_idx] = entry
        else:
            catalog.append(entry)
        _CATALOG_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info("CUSTOM_KPI_APPROVED kpi_id=%s written to kpis.json", proposal.kpi_id)
    except Exception as exc:
        raise HTTPException(500, f"Failed to write to kpis.json: {exc}")

    # Flush the in-memory catalog cache in kpi_suggester so next session reads fresh data
    try:
        import services.kpi_suggester as _ks
        _ks._catalog_cache = None
    except Exception:
        pass

    # Mark as approved in DB — if this fails, roll back the file write to keep file+DB in sync
    try:
        proposal.status = "approved"
        proposal.formula = formula
        proposal.description = description
        db.commit()
    except Exception as exc:
        try:
            _CATALOG_PATH.write_text(old_catalog_text, encoding="utf-8")
            logger.warning("CUSTOM_KPI_ROLLBACK kpi_id=%s — DB commit failed, catalog restored", proposal.kpi_id)
        except Exception as restore_exc:
            logger.error("CUSTOM_KPI_ROLLBACK_FAIL kpi_id=%s — catalog may be inconsistent: %r", proposal.kpi_id, restore_exc)
        raise HTTPException(500, f"Database update failed: {exc}")

    return {"status": "approved", "kpi_id": proposal.kpi_id, "written_to_catalog": True}


@router.post("/custom/{proposal_id}/reject")
def reject_custom_kpi(proposal_id: int, db: Session = Depends(get_db)):
    """Reject a custom KPI proposal — marks it as rejected, no catalog change."""
    from models.custom_kpi_proposal import CustomKpiProposal

    proposal = db.query(CustomKpiProposal).filter(CustomKpiProposal.id == proposal_id).first()
    if not proposal:
        raise HTTPException(404, "Custom KPI proposal not found.")

    proposal.status = "rejected"
    db.commit()
    return {"status": "rejected", "kpi_id": proposal.kpi_id}


# ── Catalog KPI endpoints — /{kpi_id} MUST come after /custom ────────────────

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
