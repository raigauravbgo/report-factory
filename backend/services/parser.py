import io

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from services import storage


def parse_upload(upload_id: int, s3_key: str, db: Session) -> pd.DataFrame:
    """Download upload from storage, parse into DataFrame, write to staging table."""
    raw = storage.download_bytes(s3_key)
    df = _read_file(s3_key, raw)
    df = _sanitize_columns(df)
    table_name = f"staging_{upload_id}"
    _write_staging_table(df, table_name, db)
    return df


def _read_file(s3_key: str, raw: bytes) -> pd.DataFrame:
    buf = io.BytesIO(raw)
    if s3_key.endswith(".csv"):
        return pd.read_csv(buf, low_memory=False)
    return pd.read_excel(buf, engine="openpyxl")


def _sanitize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names to be safe for MySQL identifiers."""
    df.columns = (
        pd.Index(df.columns)
        .str.strip()
        .str.lower()
        .str.replace(r"[^\w]", "_", regex=True)
        .str.replace(r"_+", "_", regex=True)
        .str.strip("_")
    )
    # Deduplicate: col, col_1, col_2 …
    seen: dict[str, int] = {}
    new_cols = []
    for col in df.columns:
        if col in seen:
            seen[col] += 1
            new_cols.append(f"{col}_{seen[col]}")
        else:
            seen[col] = 0
            new_cols.append(col)
    df.columns = pd.Index(new_cols)
    return df


def _write_staging_table(df: pd.DataFrame, table_name: str, db: Session) -> None:
    from sqlalchemy import inspect as sa_inspect
    # Skip if the staging table was already written (avoids re-parsing large files)
    if sa_inspect(db.get_bind()).has_table(table_name):
        return
    df.to_sql(table_name, con=db.get_bind(), index=False, if_exists="replace", chunksize=5000)
