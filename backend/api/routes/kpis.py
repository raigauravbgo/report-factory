import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
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


@router.get("/from-recipe/{recipe_id}")
def get_custom_kpis_from_recipe(recipe_id: int, db: Session = Depends(get_db)):
    """Return the custom KPIs that were user-created in a recipe's dataset pipeline."""
    from models.report_recipe import ReportRecipe
    from models.dataset import Dataset

    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, f"Recipe {recipe_id} not found.")

    dataset = db.query(Dataset).filter(Dataset.id == recipe.dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    custom_kpis = (dataset.pipeline_context or {}).get("custom_kpis", [])
    return {
        "recipe_id": recipe_id,
        "dataset_id": recipe.dataset_id,
        "custom_kpis": custom_kpis,
    }


@router.post("/contribute")
def contribute_kpis_to_registry(body: dict):
    """
    Register user-validated custom KPIs from a recipe into the shared KPI catalog.
    Body: { recipe_id: int, contributions: [{name, formula, domain, format, description}] }
    Each contribution is added with reviewed=False (pending central data team approval).
    """
    recipe_id = body.get("recipe_id")
    contributions = body.get("contributions", [])

    if not contributions:
        raise HTTPException(422, "No KPI contributions provided.")

    registered = []
    skipped = []

    for contrib in contributions:
        name = (contrib.get("name") or "").strip()
        formula = (contrib.get("formula") or "").strip()
        domain = contrib.get("domain") or "ops"
        fmt = contrib.get("format") or "number"
        description = contrib.get("description") or ""

        if not name or not formula:
            continue

        # Generate a safe kpi_id slug from the display name
        base_id = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        kpi_id = base_id

        # Append recipe suffix to avoid collision with existing entries
        if get_kpi_by_id(kpi_id):
            kpi_id = f"{base_id}_r{recipe_id}" if recipe_id else f"{base_id}_custom"

        if get_kpi_by_id(kpi_id):
            skipped.append({"name": name, "reason": "already exists in catalog"})
            continue

        kpi = create_kpi({
            "kpi_id": kpi_id,
            "display_name": name,
            "description": description,
            "numerator": formula,
            "denominator": "_none_",
            "format": fmt,
            "domain": domain,
            "reviewed": False,
        })
        registered.append(kpi)

    return {
        "registered_count": len(registered),
        "skipped_count": len(skipped),
        "registered": registered,
        "skipped": skipped,
    }
