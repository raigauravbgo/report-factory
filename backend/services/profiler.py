import re
from typing import Any, Literal

import pandas as pd

from schemas.upload import ColumnProfile, ProfilingResult

# Column name fragments that strongly hint at a date column
_DATE_NAME_HINTS = re.compile(
    r"\b(date|day|week|month|year|time|dt|created|updated|timestamp|period)\b",
    re.IGNORECASE,
)

# Threshold: if >= this fraction of non-null values parse as dates, treat as date
_DATE_PARSE_THRESHOLD = 0.85

# A column is "high cardinality" (text, not dimension) if unique ratio exceeds this
_HIGH_CARDINALITY_RATIO = 0.5
# …unless the absolute unique count is small enough to still be categorical
_MAX_DIMENSION_UNIQUES = 100


def profile(df: pd.DataFrame, upload_id: int) -> ProfilingResult:
    row_count = len(df)
    duplicate_row_count = int(df.duplicated().sum())
    columns = [_profile_column(df[col], col) for col in df.columns]

    return ProfilingResult(
        upload_id=upload_id,
        row_count=row_count,
        duplicate_row_count=duplicate_row_count,
        columns=columns,
    )


def _profile_column(series: pd.Series, name: str) -> ColumnProfile:
    total = len(series)
    missing_count = int(series.isna().sum())
    missing_pct = round(missing_count / total * 100, 2) if total else 0.0
    non_null = series.dropna()
    unique_count = int(series.nunique(dropna=True))
    sample_values = non_null.head(5).tolist()

    detected_type, suggested_role = _classify(series, name, non_null, unique_count, total)

    return ColumnProfile(
        name=name,
        raw_dtype=str(series.dtype),
        detected_type=detected_type,
        suggested_role=suggested_role,
        missing_count=missing_count,
        missing_pct=missing_pct,
        unique_count=unique_count,
        sample_values=_serialize(sample_values),
    )


def _classify(
    series: pd.Series,
    name: str,
    non_null: pd.Series,
    unique_count: int,
    total: int,
) -> tuple[Literal["date", "numeric", "categorical", "text"], Literal["date", "dimension", "measure"]]:
    # Already a datetime dtype
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date", "date"

    # Numeric dtype
    if pd.api.types.is_numeric_dtype(series):
        # Low unique count numerics (e.g. boolean-like flags) work better as dimensions
        if unique_count <= 5:
            return "categorical", "dimension"
        return "numeric", "measure"

    # Object / string column — try date detection first
    if len(non_null) > 0:
        if _looks_like_date(series, name, non_null):
            return "date", "date"

    # Cardinality-based split: dimension vs free text
    unique_ratio = unique_count / total if total else 0
    if unique_count <= _MAX_DIMENSION_UNIQUES or unique_ratio <= _HIGH_CARDINALITY_RATIO:
        return "categorical", "dimension"

    return "text", "dimension"


def _looks_like_date(series: pd.Series, name: str, non_null: pd.Series) -> bool:
    # Name hint is a strong signal
    if _DATE_NAME_HINTS.search(name):
        # Confirm at least some values parse
        parsed = pd.to_datetime(non_null.astype(str), errors="coerce")
        return parsed.notna().mean() >= 0.5

    # No name hint — require a higher parse success rate
    sample = non_null.head(200).astype(str)
    parsed = pd.to_datetime(sample, errors="coerce")
    return parsed.notna().mean() >= _DATE_PARSE_THRESHOLD


def _serialize(values: list[Any]) -> list[Any]:
    """Convert numpy/pandas scalars to Python natives so Pydantic can serialize them."""
    result = []
    for v in values:
        if hasattr(v, "item"):
            result.append(v.item())
        elif isinstance(v, float) and pd.isna(v):
            result.append(None)
        elif isinstance(v, pd.Timestamp):
            result.append(v.isoformat())
        else:
            result.append(v)
    return result
