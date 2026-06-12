from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.dataset import Dataset
from schemas.interview import KpiSelectionRequest, KpiSuggestion, ValidationResult
from services import kpi_suggester, validator

router = APIRouter(prefix="/kpi-suggestions", tags=["kpi-suggestions"])


@router.post("", response_model=dict, status_code=200)
def get_kpi_suggestions(
    body: dict,
    db: Session = Depends(get_db),
):
    """Return AI-ranked KPI suggestions for a dataset."""
    dataset_id = body.get("dataset_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required.")

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    suggestions = kpi_suggester.suggest(dataset_id, db, use_ai=False)

    return {
        "dataset_id": dataset_id,
        "suggestions": suggestions,
        "total_catalog_count": len(suggestions),
    }


@router.post("/select", response_model=dict, status_code=200)
def select_kpis(
    req: KpiSelectionRequest,
    db: Session = Depends(get_db),
):
    """Save user's KPI selection and validate any custom KPI formulas."""
    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    errors = []

    # Validate custom KPI formulas
    from models.column_schema import ColumnSchema
    from models.upload import Upload

    upload_ids = [u.id for u in db.query(Upload).filter(Upload.dataset_id == req.dataset_id).all()]
    available_cols = [
        c.column_name
        for c in db.query(ColumnSchema).filter(ColumnSchema.upload_id.in_(upload_ids)).all()
    ]

    for kpi in req.custom_kpis:
        result = validator.validate_kpi_formula(kpi.formula, available_cols)
        if not result.valid:
            for e in result.errors:
                errors.append({"kpi": kpi.name, **e.model_dump()})

    if errors:
        raise HTTPException(422, {"message": "KPI formula validation failed.", "errors": errors})

    # D1: resolve catalog KPI formulas to actual column names in this dataset
    resolved_kpi_formulas: dict[str, str] = {}
    resolution_warnings: list[dict] = []
    try:
        from db.database import get_kpi_catalog
        catalog = {k["kpi_id"]: k for k in get_kpi_catalog()}
        for kpi_id in req.selected_kpi_ids:
            if kpi_id in catalog:
                resolved = kpi_suggester.resolve_kpi_formula(catalog[kpi_id], available_cols)
                if resolved:
                    resolved_kpi_formulas[kpi_id] = resolved
                    # D2: validate the resolved formula to catch resolution errors early
                    val_result = validator.validate_kpi_formula(resolved, available_cols)
                    if not val_result.valid:
                        for e in val_result.errors:
                            resolution_warnings.append({"kpi_id": kpi_id, **e.model_dump()})
                else:
                    resolution_warnings.append({
                        "kpi_id": kpi_id,
                        "field": "formula",
                        "message": f"Could not map catalog fields for '{kpi_id}' to any column in this dataset. The KPI will use the catalog formula name.",
                        "severity": "warning",
                    })
    except Exception:
        pass  # resolution is best-effort; don't block the select if it fails

    # Create a new dict to ensure SQLAlchemy detects the JSON mutation
    new_context = {
        **(dataset.pipeline_context or {}),
        "selected_kpi_ids": req.selected_kpi_ids,
        "custom_kpis": [k.model_dump() for k in req.custom_kpis],
        "kpi_source_map": req.kpi_source_map,  # kpi_id → upload_id of source fact table
        "resolved_kpi_formulas": resolved_kpi_formulas,  # D1: column-resolved formulas
    }
    dataset.pipeline_context = new_context
    dataset.pipeline_stage = "dimension_selection"
    db.commit()

    return {
        "dataset_id": req.dataset_id,
        "selected_kpi_ids": req.selected_kpi_ids,
        "custom_kpi_count": len(req.custom_kpis),
        "pipeline_stage": dataset.pipeline_stage,
        "resolved_formula_count": len(resolved_kpi_formulas),
        "validation": {"valid": True, "errors": resolution_warnings},
    }
