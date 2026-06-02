import io

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.dataset import Dataset
from models.staging_table import StagingTable
from models.upload import Upload
from schemas.upload import (
    BatchUploadResponse,
    BatchUploadItem,
    ProfilingResult,
    SaveSchemaOverridesRequest,
    UploadResponse,
)
from services import parser, profiler, storage

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}


def _get_client_id(x_client_id: str = Header(default="default")) -> str:
    return x_client_id


# ── Single file upload (keep for backwards compatibility) ─────────────────────

@router.post("", response_model=UploadResponse, status_code=201)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    dataset_name: str = "",
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    filename, contents = await _validate_and_read(file)
    dataset = Dataset(client_id=client_id, name=dataset_name.strip() or filename.rsplit(".", 1)[0])
    db.add(dataset)
    db.flush()
    upload = _create_upload(db, client_id, dataset.id, filename, contents)
    db.commit()
    db.refresh(upload)
    background_tasks.add_task(_parse_and_profile, upload.id, upload.s3_key, client_id)
    return upload


# ── Batch upload ──────────────────────────────────────────────────────────────

@router.post("/batch", response_model=BatchUploadResponse, status_code=201)
async def upload_batch(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    dataset_name: str = "",
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    if len(files) > settings.max_upload_files:
        raise HTTPException(400, f"Maximum {settings.max_upload_files} files per batch.")

    # One Dataset as session container for all files
    name = dataset_name.strip() or "batch_upload"
    dataset = Dataset(client_id=client_id, name=name)
    db.add(dataset)
    db.flush()

    items: list[BatchUploadItem] = []
    for file in files:
        filename, contents = await _validate_and_read(file)
        upload = _create_upload(db, client_id, dataset.id, filename, contents)
        db.flush()
        items.append(BatchUploadItem(upload_id=upload.id, filename=filename, status="pending"))
        background_tasks.add_task(_parse_and_profile, upload.id, upload.s3_key, client_id)

    db.commit()
    return BatchUploadResponse(dataset_id=dataset.id, uploads=items)


# ── Poll / profile ────────────────────────────────────────────────────────────

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


# ── Schema overrides ──────────────────────────────────────────────────────────

@router.post("/{upload_id}/schema", response_model=ProfilingResult)
def save_schema_overrides(
    upload_id: int,
    body: SaveSchemaOverridesRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Persist user edits to column roles, semantic tags, and grain selections."""
    staging = (
        db.query(StagingTable)
        .join(Upload)
        .filter(StagingTable.upload_id == upload_id, Upload.client_id == client_id)
        .first()
    )
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile not found.")

    profile_data = dict(staging.profile_data)
    override_map = {o.name: o for o in body.column_overrides}

    for col in profile_data.get("columns", []):
        if col["name"] in override_map:
            ov = override_map[col["name"]]
            if ov.detected_type is not None:
                col["detected_type"] = ov.detected_type
            if ov.suggested_role is not None:
                col["suggested_role"] = ov.suggested_role
            if ov.semantic_tag is not None:
                col["semantic_tag"] = ov.semantic_tag
            if ov.in_grain is not None:
                col["grain_candidate"] = ov.in_grain

    if body.active_sheet is not None:
        profile_data["active_sheet"] = body.active_sheet
        staging.active_sheet = body.active_sheet

    # Update grain_columns on staging record for relationship detection
    grain_cols = [c["name"] for c in profile_data.get("columns", []) if c.get("grain_candidate")]
    staging.grain_columns = grain_cols
    staging.profile_data = profile_data
    db.commit()

    return ProfilingResult(**profile_data)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _validate_and_read(file: UploadFile) -> tuple[str, bytes]:
    filename = file.filename or ""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file '{filename}'. Upload .xlsx, .xls, or .csv.")
    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(413, f"File '{filename}' exceeds {settings.max_upload_size_mb}MB limit.")
    return filename, contents


def _create_upload(db: Session, client_id: str, dataset_id: int, filename: str, contents: bytes) -> Upload:
    s3_key = f"{client_id}/{dataset_id}/{filename}"
    storage.upload_file(io.BytesIO(contents), s3_key)
    upload = Upload(client_id=client_id, dataset_id=dataset_id, s3_key=s3_key, filename=filename, status="pending")
    db.add(upload)
    return upload


# ── Background task ───────────────────────────────────────────────────────────

def _parse_and_profile(upload_id: int, s3_key: str, client_id: str) -> None:
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        if not upload:
            return

        upload.status = "profiling"
        db.commit()

        parse_result = parser.parse_upload(upload_id, s3_key, db)
        result = profiler.profile(parse_result.df, upload_id)

        # Merge file-level metadata into ProfilingResult
        result.encoding = parse_result.encoding
        result.delimiter = parse_result.delimiter
        result.sheet_names = parse_result.sheet_names
        result.active_sheet = parse_result.active_sheet

        staging = StagingTable(
            client_id=client_id,
            upload_id=upload_id,
            table_name=f"staging_{upload_id}",
            row_count=result.row_count,
            column_count=len(result.columns),
            duplicate_row_count=result.duplicate_row_count,
            profile_data=result.model_dump(),
            encoding=parse_result.encoding,
            delimiter=parse_result.delimiter,
            sheet_names=parse_result.sheet_names,
            active_sheet=parse_result.active_sheet,
            grain_columns=result.grain_suggestions,
        )
        db.add(staging)
        upload.status = "profiled"
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
