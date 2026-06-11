import io
import logging
import time

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

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
    logger.info("FILE_UPLOAD upload_id=%d file=%r size=%.1fKB client=%s", upload.id, filename, len(contents) / 1024, client_id)
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
        logger.info("FILE_UPLOAD upload_id=%d file=%r size=%.1fKB dataset_id=%d client=%s",
                    upload.id, filename, len(contents) / 1024, dataset.id, client_id)
        background_tasks.add_task(_parse_and_profile, upload.id, upload.s3_key, client_id)

    db.commit()
    logger.info("BATCH_UPLOAD dataset_id=%d files=%d client=%s", dataset.id, len(items), client_id)
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
        raise HTTPException(503, detail={"status": upload.status, "message": "Profiling still in progress."})
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
    """Persist user edits to column roles, semantic tags, and grain selections.

    When active_sheet changes on a multi-sheet Excel file the staging table is
    rebuilt from the new sheet so that dashboard computation uses the correct data.
    """
    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile not found.")

    # Re-parse when the active sheet changes so staging data matches the selected sheet
    if body.active_sheet is not None and body.active_sheet != staging.active_sheet:
        try:
            t0 = time.perf_counter()
            parse_result = parser.parse_upload(upload_id, upload.s3_key, db, active_sheet=body.active_sheet)
            result = profiler.profile(parse_result.df, upload_id)
            result.encoding = parse_result.encoding
            result.delimiter = parse_result.delimiter
            result.sheet_names = parse_result.sheet_names
            result.active_sheet = parse_result.active_sheet

            profile_data = result.model_dump()
            staging.profile_data = profile_data
            staging.active_sheet = parse_result.active_sheet
            staging.row_count = result.row_count
            staging.column_count = len(result.columns)
            staging.duplicate_row_count = result.duplicate_row_count
            staging.grain_columns = result.grain_suggestions
            db.commit()
            logger.info(
                "SHEET_REPARSE upload_id=%d sheet=%r rows=%d duration=%.2fs",
                upload_id, parse_result.active_sheet, result.row_count, time.perf_counter() - t0,
            )
        except Exception as exc:
            logger.error("SHEET_REPARSE_FAIL upload_id=%d sheet=%r error=%r", upload_id, body.active_sheet, str(exc))
            raise HTTPException(500, f"Failed to re-parse sheet '{body.active_sheet}': {exc}")

    # Apply any column role/tag overrides on top of (possibly refreshed) profile
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
            if ov.in_filter is not None:
                col["is_filter"] = ov.in_filter

    grain_cols = [c["name"] for c in profile_data.get("columns", []) if c.get("grain_candidate")]
    staging.grain_columns = grain_cols
    staging.profile_data = profile_data
    db.commit()

    return ProfilingResult(**profile_data)


# ── Table type override ───────────────────────────────────────────────────────

@router.patch("/{upload_id}/table-type")
def update_table_type(
    upload_id: int,
    body: dict,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Let the user override the AI-suggested fact/dimension classification.

    Stores the new value in profile_data["table_type"] so it persists and is
    returned by GET /upload/{id}/profile.
    """
    new_type = (body.get("table_type") or "").strip()
    if new_type not in ("fact", "dimension", "unknown"):
        raise HTTPException(400, "table_type must be 'fact', 'dimension', or 'unknown'")

    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")
    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile data not found.")

    profile = dict(staging.profile_data)
    profile["table_type"] = new_type
    staging.profile_data = profile
    db.commit()
    logger.info("TABLE_TYPE_OVERRIDE upload_id=%d new_type=%s", upload_id, new_type)
    return {"status": "ok", "upload_id": upload_id, "table_type": new_type}


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
    t0 = time.perf_counter()
    try:
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        if not upload:
            return

        upload.status = "profiling"
        db.commit()
        logger.info("PROFILING_START upload_id=%d file=%r", upload_id, upload.filename)

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
        logger.info(
            "PROFILING_DONE upload_id=%d rows=%d cols=%d dupes=%d duration=%.2fs",
            upload_id, result.row_count, len(result.columns),
            result.duplicate_row_count, time.perf_counter() - t0,
        )

    except Exception as exc:
        db.rollback()
        logger.error("PROFILING_FAIL upload_id=%d error=%r", upload_id, str(exc))
        upload = db.query(Upload).filter(Upload.id == upload_id).first()
        if upload:
            upload.status = "failed"
            upload.error_message = str(exc)
            db.commit()
    finally:
        db.close()
