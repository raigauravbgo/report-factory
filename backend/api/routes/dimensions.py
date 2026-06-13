from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.dataset import Dataset
from schemas.interview import DimensionSelectionRequest, DimensionSuggestion
from services import dimension_suggester

router = APIRouter(prefix="/dimensions", tags=["dimensions"])


@router.get("/{dataset_id}", response_model=dict)
def get_dimension_suggestions(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    """Return dimension columns from confirmed dimension tables only."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    suggestions = dimension_suggester.suggest(dataset_id, db, use_ai=False)

    return {
        "dataset_id": dataset_id,
        "suggestions": suggestions,
    }


@router.post("/{dataset_id}/select", response_model=dict, status_code=200)
def select_dimensions(
    dataset_id: int,
    req: DimensionSelectionRequest,
    db: Session = Depends(get_db),
):
    """Save dimension selection and advance pipeline stage to 'recipe'."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    # Create a new dict to ensure SQLAlchemy detects the JSON mutation
    new_context = {**(dataset.pipeline_context or {}), "selected_dimensions": req.selected_dimensions}
    dataset.pipeline_context = new_context
    dataset.pipeline_stage = "recipe"
    db.commit()

    return {
        "dataset_id": dataset_id,
        "selected_dimensions": req.selected_dimensions,
        "pipeline_stage": dataset.pipeline_stage,
    }
