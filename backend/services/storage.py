import os
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from core.config import settings

_LOCAL_UPLOAD_DIR = Path(__file__).parent.parent / "local_uploads"


def _use_local() -> bool:
    return not settings.aws_access_key_id or settings.app_env == "development"


def _safe_local_path(s3_key: str) -> Path:
    """Resolve s3_key relative to the upload dir and reject path-traversal attempts."""
    resolved = (_LOCAL_UPLOAD_DIR / s3_key).resolve()
    if not str(resolved).startswith(str(_LOCAL_UPLOAD_DIR.resolve())):
        raise ValueError(f"Unsafe path rejected: {s3_key!r}")
    return resolved


def upload_file(file_obj: BinaryIO, s3_key: str) -> str:
    """Upload a file-like object. Returns the S3 key (or local path key)."""
    if _use_local():
        dest = _safe_local_path(s3_key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(file_obj.read())
        return s3_key

    client = boto3.client(
        "s3",
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    try:
        client.upload_fileobj(file_obj, settings.s3_bucket, s3_key)
    except (BotoCoreError, ClientError) as e:
        raise RuntimeError(f"S3 upload failed: {e}") from e

    return s3_key


def download_bytes(s3_key: str) -> bytes:
    """Download a stored file and return its raw bytes."""
    if _use_local():
        return _safe_local_path(s3_key).read_bytes()

    client = boto3.client(
        "s3",
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    response = client.get_object(Bucket=settings.s3_bucket, Key=s3_key)
    return response["Body"].read()
