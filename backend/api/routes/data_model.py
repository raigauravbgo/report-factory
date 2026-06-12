from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.data_model import DataModel
from models.dataset import Dataset
from models.upload import Upload
from schemas.interview import (
    BridgeDim,
    ConfirmDataModelRequest,
    DataModelFkEntry,
    DataModelResponse,
    DataModelTableEntry,
    ValidationResult,
)
from services import data_modeler, validator

router = APIRouter(prefix="/data-model", tags=["data-model"])


def _get_client_id(x_client_id: str = "") -> str:
    return x_client_id or "default"


def _to_response(dm: DataModel, validation: ValidationResult | None = None) -> DataModelResponse:
    tables = [DataModelTableEntry(**t) for t in (dm.tables or [])]
    fks = [DataModelFkEntry(**f) for f in (dm.foreign_keys or [])]
    pks = {str(k): v for k, v in (dm.primary_keys or {}).items()}
    raw_bridges = data_modeler.detect_bridge_dims(dm.tables or [], dm.foreign_keys or [])
    bridge_dims = [BridgeDim(**b) for b in raw_bridges]
    return DataModelResponse(
        id=dm.id,
        dataset_id=dm.dataset_id,
        status=dm.status,
        tables=tables,
        primary_keys=pks,
        foreign_keys=fks,
        ai_reasoning=dm.ai_reasoning,
        bridge_dims=bridge_dims,
        validation=validation,
    )


@router.post("/suggest", response_model=DataModelResponse, status_code=201)
def suggest_data_model(
    body: dict,
    db: Session = Depends(get_db),
):
    """Run AI + heuristic analysis on all uploaded files in the dataset."""
    dataset_id = body.get("dataset_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required.")

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    # Remove any existing suggestion so we always get a fresh one
    existing = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    if existing:
        db.delete(existing)
        db.flush()

    model_dict = data_modeler.suggest(dataset_id, db)
    dm = DataModel(
        dataset_id=dataset_id,
        status="ai_suggested",
        tables=model_dict["tables"],
        primary_keys=model_dict["primary_keys"],
        foreign_keys=model_dict["foreign_keys"],
        ai_reasoning=model_dict.get("ai_reasoning"),
    )
    db.add(dm)
    db.commit()
    db.refresh(dm)

    validation = validator.validate_data_model(dataset_id, db)
    return _to_response(dm, validation)


@router.get("/{dataset_id}", response_model=DataModelResponse)
def get_data_model(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    if not dm:
        raise HTTPException(404, "Data model not found. Call POST /data-model/suggest first.")
    return _to_response(dm)


@router.post("/{dataset_id}/confirm", response_model=dict)
def confirm_data_model(
    dataset_id: int,
    req: ConfirmDataModelRequest,
    db: Session = Depends(get_db),
):
    """Apply user overrides, validate, and advance pipeline stage to 'interview'."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    if not dm:
        raise HTTPException(404, "Data model not found.")

    data_modeler.apply_overrides(
        dm.id,
        {
            "table_overrides": [o.model_dump() for o in req.table_overrides],
            "pk_overrides": req.pk_overrides,
            "fk_overrides": [o.model_dump() for o in req.fk_overrides],
            "primary_fact_upload_id": req.primary_fact_upload_id,
        },
        db,
    )

    validation = validator.validate_data_model(dataset_id, db)

    # Advance pipeline stage
    dataset.pipeline_stage = "interview"
    db.commit()
    db.refresh(dm)

    return {
        "dataset_id": dataset_id,
        "pipeline_stage": dataset.pipeline_stage,
        "data_model": _to_response(dm).model_dump(),
        "validation": validation.model_dump(),
    }
