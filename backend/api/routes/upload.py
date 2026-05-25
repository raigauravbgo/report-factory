from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.dataset import Dataset
from models.staging_table import StagingTable
from models.upload import Upload
from schemas.upload import ProfilingResult, UploadResponse
from services import parser, profiler, storage

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".xlsx", ".csv"}


def _get_client_id(x_client_id: str = Header(default="default")) -> str:
    return x_client_id


@router.post("", response_model=UploadResponse, status_code=201)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    dataset_name: str = "",
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    # Validate extension
    filename = file.filename or ""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .xlsx or .csv.")

    # Validate size
    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_upload_size_mb}MB limit.")

    # Create or find dataset
    name = dataset_name.strip() or filename.rsplit(".", 1)[0]
    dataset = Dataset(client_id=client_id, name=name)
    db.add(dataset)
    db.flush()

    # Build S3 key namespaced by client
    s3_key = f"{client_id}/{dataset.id}/{filename}"

    # Persist to S3 / local
    import io
    storage.upload_file(io.BytesIO(contents), s3_key)

    # Create upload record
    upload = Upload(
        client_id=client_id,
        dataset_id=dataset.id,
        s3_key=s3_key,
        filename=filename,
        status="pending",
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    # Kick off background parse + profile
    background_tasks.add_task(_parse_and_profile, upload.id, s3_key, client_id)

    return upload


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
    if upload.status == "pending" or upload.status == "profiling":
        raise HTTPException(202, "Profiling still in progress.")
    if upload.status == "failed":
        raise HTTPException(500, f"Profiling failed: {upload.error_message}")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile data not found.")

    return ProfilingResult(**staging.profile_data)


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
