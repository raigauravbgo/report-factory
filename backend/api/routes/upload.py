from fastapi import APIRouter, BackgroundTasks, Depends, Form, Header, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.dataset import Dataset
from models.staging_table import StagingTable
from models.upload import Upload
from models.report_recipe import ReportRecipe
from schemas.upload import ProfilingResult, UploadResponse
from schemas.analysis import MappingConfirmRequest, MappingConfirmResponse
from services import parser, profiler, storage

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".xlsx", ".csv"}


def _get_client_id(x_client_id: str = Header(default="default")) -> str:
    return x_client_id


@router.post("", response_model=UploadResponse, status_code=201)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    dataset_name: str = Form(default=""),
    file_type: str = Form(default="unknown"),
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

    # Create dataset record
    name = dataset_name.strip() or filename.rsplit(".", 1)[0]
    dataset = Dataset(client_id=client_id, name=name)
    db.add(dataset)
    db.flush()

    # Build storage key namespaced by client
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
        file_type=file_type,
        status="pending",
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    # Kick off background parse + profile + schema inference
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
    if upload.status in ("pending", "profiling"):
        raise HTTPException(202, "Profiling still in progress.")
    if upload.status == "failed":
        raise HTTPException(500, f"Profiling failed: {upload.error_message}")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging or not staging.profile_data:
        raise HTTPException(404, "Profile data not found.")

    return ProfilingResult(**staging.profile_data)


@router.get("/{upload_id}/mapping")
def get_mapping(
    upload_id: int,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Return the AI-inferred column mapping for an upload."""
    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")
    if upload.status in ("pending", "profiling"):
        raise HTTPException(202, "Profiling still in progress.")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging:
        raise HTTPException(404, "Staging data not found.")

    return {
        "upload_id": upload_id,
        "mapping": staging.column_mapping or {},
        "confirmed": bool(staging.mapping_confirmed),
        "available_kpis": staging.available_kpis or [],
        "blocked_kpis": staging.blocked_kpis or [],
    }


@router.post("/{upload_id}/mapping/confirm", response_model=MappingConfirmResponse)
def confirm_mapping(
    upload_id: int,
    body: MappingConfirmRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(_get_client_id),
):
    """Confirm (and optionally override) the column mapping, then evaluate KPI feasibility."""
    upload = db.query(Upload).filter(Upload.id == upload_id, Upload.client_id == client_id).first()
    if not upload:
        raise HTTPException(404, "Upload not found.")

    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging:
        raise HTTPException(404, "Staging data not found.")

    # Store the confirmed mapping
    confirmed_mapping = {col: entry.model_dump() for col, entry in body.mapping.items()}
    staging.column_mapping = confirmed_mapping
    staging.mapping_confirmed = 1

    # Derive the set of canonical columns from confirmed mapping
    confirmed_canonical = [
        entry.canonical_name
        for entry in body.mapping.values()
        if entry.status != "ignored" and entry.canonical_name
    ]

    # Evaluate KPI feasibility
    from kpi_registry.registry import KPIRegistry
    registry = KPIRegistry()
    feasibility = registry.evaluate_feasibility(confirmed_canonical)

    staging.available_kpis = feasibility["available"]
    staging.blocked_kpis = feasibility["blocked"]
    db.commit()

    # Create a recipe stub linked to this upload (used later in analysis)
    recipe = db.query(ReportRecipe).filter(ReportRecipe.upload_id == upload_id).first()
    if not recipe:
        recipe = ReportRecipe(
            client_id=client_id,
            dataset_id=upload.dataset_id,
            upload_id=upload_id,
            config={},
            analysis_status="pending",
        )
        db.add(recipe)
        db.commit()
        db.refresh(recipe)

    return MappingConfirmResponse(
        upload_id=upload_id,
        recipe_id=recipe.id,
        available_kpis=feasibility["available"],
        blocked_kpis=feasibility["blocked"],
    )


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

        # Run AI schema inference (with fallback if no API key)
        column_mapping: dict = {}
        try:
            from services.schema_inference import infer_column_mapping, infer_column_mapping_fallback
            from kpi_registry.registry import KPIRegistry
            registry = KPIRegistry()
            canonical_names = registry.get_all_canonical_names()
            sample_rows = df.head(5).to_dict(orient="records")
            if settings.openai_api_key:
                column_mapping = infer_column_mapping(
                    columns=list(df.columns),
                    sample_rows=sample_rows,
                    known_canonical_names=canonical_names,
                )
            else:
                column_mapping = infer_column_mapping_fallback(list(df.columns))
        except Exception:
            pass  # Mapping will be empty; user can fill it manually

        staging = StagingTable(
            client_id=client_id,
            upload_id=upload_id,
            table_name=f"staging_{upload_id}",
            row_count=result.row_count,
            column_count=len(result.columns),
            duplicate_row_count=result.duplicate_row_count,
            profile_data=result.model_dump(),
            column_mapping=column_mapping,
            upload_path=svc_local_path(s3_key),
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


def svc_local_path(s3_key: str) -> str:
    """Return the local filesystem path for a storage key (mirrors storage.py logic)."""
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent.parent / "local_uploads"
    return str(base / s3_key)
