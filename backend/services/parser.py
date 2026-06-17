import csv
import dataclasses
import io

import chardet
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.config import settings
from services import storage


@dataclasses.dataclass
class ParseResult:
    df: pd.DataFrame
    encoding: str
    delimiter: str
    sheet_names: list[str]
    active_sheet: str


def parse_upload(upload_id: int, s3_key: str, db: Session, active_sheet: str = "") -> ParseResult:
    """Download upload, parse into DataFrame, write to staging table. Returns ParseResult."""
    raw = storage.download_bytes(s3_key)
    result = _read_file(s3_key, raw, active_sheet)
    result.df = _sanitize_columns(result.df)
    _enforce_limits(result.df, s3_key)
    _write_staging_table(result.df, f"staging_{upload_id}", db)
    return result


def _read_file(s3_key: str, raw: bytes, active_sheet: str) -> ParseResult:
    if s3_key.lower().endswith(".csv"):
        return _read_csv(raw)
    return _read_excel(raw, active_sheet)


def _read_csv(raw: bytes) -> ParseResult:
    # Detect encoding
    detected = chardet.detect(raw)
    encoding = detected.get("encoding") or "utf-8"

    # Detect delimiter using csv.Sniffer on a sample
    sample = raw[:4096].decode(encoding, errors="replace")
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    buf = io.BytesIO(raw)
    df = pd.read_csv(buf, encoding=encoding, sep=delimiter, low_memory=False)

    return ParseResult(
        df=df,
        encoding=encoding,
        delimiter=delimiter,
        sheet_names=[],
        active_sheet="",
    )


def _read_excel(raw: bytes, active_sheet: str) -> ParseResult:
    buf = io.BytesIO(raw)
    xl = pd.ExcelFile(buf, engine="openpyxl")
    sheet_names = xl.sheet_names
    if not sheet_names:
        raise ValueError("Excel file contains no worksheets.")

    sheet = active_sheet if active_sheet in sheet_names else sheet_names[0]
    df = xl.parse(sheet)

    return ParseResult(
        df=df,
        encoding="utf-8",
        delimiter="",
        sheet_names=sheet_names,
        active_sheet=sheet,
    )


def _enforce_limits(df: pd.DataFrame, s3_key: str) -> None:
    is_excel = s3_key.lower().endswith((".xlsx", ".xls"))
    limit = settings.max_excel_rows if is_excel else settings.max_csv_rows
    if len(df) > limit:
        raise ValueError(
            f"File has {len(df):,} rows — limit is {limit:,}. "
            "Reduce file size before uploading."
        )
    if len(df.columns) > settings.max_columns_per_file:
        raise ValueError(
            f"File has {len(df.columns)} columns — limit is {settings.max_columns_per_file}. "
            "Remove unused columns before uploading."
        )


def _sanitize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names to safe identifiers."""
    df.columns = (
        pd.Index(df.columns)
        .str.strip()
        .str.lower()
        .str.replace(r"[^\w]", "_", regex=True)
        .str.replace(r"_+", "_", regex=True)
        .str.strip("_")
    )
    used: set[str] = set()
    base_counter: dict[str, int] = {}
    new_cols = []
    for col in df.columns:
        if col not in used:
            used.add(col)
            new_cols.append(col)
        else:
            # Find the next suffix that doesn't collide with any already-assigned name
            n = base_counter.get(col, 1)
            candidate = f"{col}_{n}"
            while candidate in used:
                n += 1
                candidate = f"{col}_{n}"
            base_counter[col] = n + 1
            used.add(candidate)
            new_cols.append(candidate)
    df.columns = pd.Index(new_cols)
    return df


def _write_staging_table(df: pd.DataFrame, table_name: str, db: Session) -> None:
    from core.database import engine
    db.execute(text(f'DROP TABLE IF EXISTS "{table_name}"'))
    db.commit()
    df.to_sql(table_name, con=engine, index=False, if_exists="replace", chunksize=5000)
