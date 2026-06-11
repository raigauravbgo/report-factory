import io
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.column_schema import ColumnSchema
from models.dataset import Dataset
from models.staging_table import StagingTable
from models.upload import Upload
from schemas.interview import (
    ColumnSchemaEntry,
    ConfirmSchemaRequest,
    DatasetSchemaResponse,
    ValidationResult,
)
from schemas.upload import ProfilingResult, UploadBatchResponse, UploadResponse
from services import parser, profiler, schema_mapper, storage, validator

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".xlsx", ".csv"}


def _get_client_id(x_client_id: str = Header(default="default")) -> str:
    return x_client_id


# ── Multi-file upload ─────────────────────────────────────────────────────────

@router.post("", response_model=UploadBatchResponse, status_code=201)
async def upload_files(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    dataset_name: str = Form(default=""),
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Accept one or more Excel/CSV files and kick off background profiling for each."""
    if not files:
        raise HTTPException(400, "At least one file is required.")

    # Validate all files before persisting any
    validated: list[tuple[UploadFile, bytes]] = []
    for file in files:
        filename = file.filename or ""
        contents = await file.read()
        result = validator.validate_upload(filename, len(contents), contents)
        if not result.valid:
            raise HTTPException(
                400,
                f"File '{filename}': {result.errors[0].message}",
            )
        validated.append((file, contents))

    # Create one Dataset for all files
    first_filename = validated[0][0].filename or "upload"
    name = dataset_name.strip() or first_filename.rsplit(".", 1)[0]
    dataset = Dataset(client_id=client_id, name=name, pipeline_stage="upload")
    db.add(dataset)
    db.flush()

    upload_records: list[Upload] = []
    for file, contents in validated:
        filename = file.filename or "file"
        s3_key = f"{client_id}/{dataset.id}/{filename}"
        storage.upload_file(io.BytesIO(contents), s3_key)

        upload = Upload(
            client_id=client_id,
            dataset_id=dataset.id,
            s3_key=s3_key,
            filename=filename,
            status="pending",
            schema_mapping_status="pending",
        )
        db.add(upload)
        db.flush()
        upload_records.append(upload)

        background_tasks.add_task(_parse_profile_and_map, upload.id, s3_key, client_id)

    db.commit()
    for u in upload_records:
        db.refresh(u)

    return UploadBatchResponse(
        dataset_id=dataset.id,
        uploads=[UploadResponse.model_validate(u) for u in upload_records],
    )


# ── Single-upload status + legacy profile ────────────────────────────────────

@router.get("/{upload_id}", response_model=UploadResponse)
def get_upload(
    upload_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")
    return upload


@router.get("/{upload_id}/profile", response_model=ProfilingResult)
def get_profile(
    upload_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")
    if upload.status in ("pending", "profiling"):
        raise HTTPException(202, "Profiling still in progress.")
    if upload.status == "failed":
        raise HTTPException(500, f"Profiling failed: {upload.error_message}")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile data not found.")

    return ProfilingResult(**staging.profile_data)


# ── Dataset-level endpoints ───────────────────────────────────────────────────

@router.get("/dataset/{dataset_id}", response_model=UploadBatchResponse)
def get_dataset_uploads(
    dataset_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Return all uploads for a dataset. Frontend polls this until all are profiled."""
    dataset = db.query(Dataset).filter(
        Dataset.id == dataset_id, Dataset.client_id == client_id
    ).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    return UploadBatchResponse(
        dataset_id=dataset_id,
        uploads=[UploadResponse.model_validate(u) for u in uploads],
    )


@router.get("/dataset/{dataset_id}/schema", response_model=DatasetSchemaResponse)
def get_dataset_schema(
    dataset_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Return ColumnSchema records for all uploads in the dataset."""
    dataset = db.query(Dataset).filter(
        Dataset.id == dataset_id, Dataset.client_id == client_id
    ).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    result = []
    for upload in uploads:
        cols = (
            db.query(ColumnSchema)
            .filter(ColumnSchema.upload_id == upload.id)
            .order_by(ColumnSchema.id)
            .all()
        )
        result.append(
            {
                "upload_id": upload.id,
                "filename": upload.filename,
                "status": upload.status,
                "schema_mapping_status": upload.schema_mapping_status,
                "columns": [ColumnSchemaEntry.model_validate(c) for c in cols],
            }
        )

    return DatasetSchemaResponse(dataset_id=dataset_id, uploads=result)


@router.post(
    "/dataset/{dataset_id}/schema/confirm",
    response_model=dict,
    status_code=200,
)
def confirm_schema(
    dataset_id: int,
    requests: list[ConfirmSchemaRequest],
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Apply user overrides to column schemas and advance pipeline stage."""
    dataset = db.query(Dataset).filter(
        Dataset.id == dataset_id, Dataset.client_id == client_id
    ).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found.")

    for req in requests:
        overrides = [o.model_dump(exclude_none=False) for o in req.overrides]
        schema_mapper.apply_overrides(req.upload_id, overrides, db)

        # Mark upload schema as confirmed
        upload = db.query(Upload).filter(Upload.id == req.upload_id).first()
        if upload:
            upload.schema_mapping_status = "confirmed"

    db.flush()

    # Validate after overrides are applied so effective_role reflects user changes
    validation: ValidationResult = validator.validate_schema_mapping(dataset_id, db)

    if validation.valid:
        dataset.pipeline_stage = "data_modeling"

    db.commit()

    return {
        "dataset_id": dataset_id,
        "pipeline_stage": dataset.pipeline_stage,
        "validation": validation.model_dump(),
    }


# ── Background task ───────────────────────────────────────────────────────────

def _parse_profile_and_map(upload_id: int, s3_key: str, client_id: str) -> None:
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        if not upload:
            return

        upload.status = "profiling"
        db.commit()

        df = parser.parse_upload(upload_id, s3_key, db)
        result = profiler.profile(df, upload_id)

        staging = StagingTable(
            client_id=client_id,
            upload_id=upload_id,
            table_name=f"staging_{upload_id}",
            row_count=result.row_count,
            column_count=len(result.columns),
            duplicate_row_count=result.duplicate_row_count,
            profile_data=result.model_dump(),
        )
        db.add(staging)

        # AI-enhanced schema mapping
        schema_rows = schema_mapper.suggest_from_profile(
            result, df, upload_id, upload.filename, use_ai=False
        )
        for row in schema_rows:
            col_schema = ColumnSchema(**row)
            db.add(col_schema)

        upload.status = "profiled"
        upload.schema_mapping_status = "ai_suggested"
        db.commit()

    except Exception as exc:
        db.rollback()
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        if upload:
            upload.status = "failed"
            upload.error_message = str(exc)
            db.commit()
    finally:
        db.close()
