import json
import logging
import re
from typing import Any, Literal

import pandas as pd

from schemas.upload import ColumnProfile, ProfilingResult

logger = logging.getLogger(__name__)

# Column name patterns → semantic tag
_ENTITY_KEY_RE = re.compile(r"\b(id|key|code|num|number|ref)\b", re.IGNORECASE)
_TIME_KEY_RE = re.compile(
    r"\b(date|day|week|month|year|time|dt|created|updated|timestamp|period)\b",
    re.IGNORECASE,
)
_FINANCIAL_RE = re.compile(
    r"\b(revenue|amount|cost|price|balance|profit|sales|payment|fee|charge|total|value|spend)\b",
    re.IGNORECASE,
)

# Date detection
_DATE_NAME_HINTS = _TIME_KEY_RE
_DATE_PARSE_THRESHOLD = 0.85
_HIGH_CARDINALITY_RATIO = 0.5
_MAX_DIMENSION_UNIQUES = 100

# Grain: columns with unique_count / row_count >= this are grain candidates
_GRAIN_THRESHOLD = 0.95


def profile(df: pd.DataFrame, upload_id: int) -> ProfilingResult:
    row_count = len(df)
    duplicate_row_count = int(df.duplicated().sum())
    columns = [_profile_column(df[col], col, row_count) for col in df.columns]
    grain_suggestions = _infer_grain_suggestions(columns)

    return ProfilingResult(
        upload_id=upload_id,
        row_count=row_count,
        duplicate_row_count=duplicate_row_count,
        columns=columns,
        grain_suggestions=grain_suggestions,
    )


def _profile_column(series: pd.Series, name: str, row_count: int) -> ColumnProfile:
    total = len(series)
    missing_count = int(series.isna().sum())
    missing_pct = round(missing_count / total * 100, 2) if total else 0.0
    non_null = series.dropna()
    unique_count = int(series.nunique(dropna=True))
    sample_values = non_null.head(5).tolist()

    detected_type, suggested_role = _classify(series, name, non_null, unique_count, total)
    semantic_tag = _infer_semantic_tag(name, detected_type, suggested_role)
    grain_score = round(unique_count / row_count, 4) if row_count else 0.0
    grain_candidate = grain_score >= _GRAIN_THRESHOLD

    return ColumnProfile(
        name=name,
        raw_dtype=str(series.dtype),
        detected_type=detected_type,
        suggested_role=suggested_role,
        missing_count=missing_count,
        missing_pct=missing_pct,
        unique_count=unique_count,
        sample_values=_serialize(sample_values),
        semantic_tag=semantic_tag,
        grain_score=grain_score,
        grain_candidate=grain_candidate,
    )


def _classify(
    series: pd.Series,
    name: str,
    non_null: pd.Series,
    unique_count: int,
    total: int,
) -> tuple[Literal["date", "numeric", "categorical", "text"], Literal["date", "dimension", "measure"]]:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date", "date"

    if pd.api.types.is_numeric_dtype(series):
        if unique_count <= 5:
            return "categorical", "dimension"
        return "numeric", "measure"

    if len(non_null) > 0 and _looks_like_date(series, name, non_null):
        return "date", "date"

    # Detect columns stored as strings in Excel/CSV that actually contain numeric data
    # (e.g. avg_csat_rating, csat_survey_volume stored as text by the source system).
    if len(non_null) >= 5:
        sample = non_null.head(200).astype(str).str.strip().str.replace(",", "", regex=False)
        coerced = pd.to_numeric(sample, errors="coerce")
        if coerced.notna().mean() >= 0.85:
            if unique_count <= 5:
                return "categorical", "dimension"
            return "numeric", "measure"

    unique_ratio = unique_count / total if total else 0
    if unique_count <= _MAX_DIMENSION_UNIQUES or unique_ratio <= _HIGH_CARDINALITY_RATIO:
        return "categorical", "dimension"

    return "text", "dimension"


_DD_MM_YYYY_RE = re.compile(
    r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$"
)


def _looks_like_date(series: pd.Series, name: str, non_null: pd.Series) -> bool:
    sample_str = non_null.head(200).astype(str).str.strip()

    # Fast path: name strongly suggests a date column
    # H9: Use same 0.85 threshold as general parse — 0.5 was too permissive and
    # caused columns with mixed data (e.g. 60% dates) to be typed as DATE.
    if _DATE_NAME_HINTS.search(name):
        parsed = pd.to_datetime(sample_str, errors="coerce", dayfirst=True)
        if parsed.notna().mean() >= _DATE_PARSE_THRESHOLD:
            return True
        parsed = pd.to_datetime(sample_str, errors="coerce", format="mixed")
        return parsed.notna().mean() >= _DATE_PARSE_THRESHOLD

    # Check if values look like DD-MM-YYYY / DD/MM/YYYY by pattern
    dd_mm_matches = sample_str.str.match(_DD_MM_YYYY_RE).mean()
    if dd_mm_matches >= 0.8:
        parsed = pd.to_datetime(sample_str, errors="coerce", dayfirst=True)
        if parsed.notna().mean() >= _DATE_PARSE_THRESHOLD:
            return True

    # General parse (YYYY-MM-DD, ISO, mixed)
    parsed = pd.to_datetime(sample_str, errors="coerce", format="mixed")
    return parsed.notna().mean() >= _DATE_PARSE_THRESHOLD


def _infer_semantic_tag(
    name: str,
    detected_type: str,
    suggested_role: str,
) -> Literal["entity_key", "time_key", "financial_metric", "dimension", "text", "ignore"]:
    if detected_type == "date" or _TIME_KEY_RE.search(name):
        return "time_key"
    if _ENTITY_KEY_RE.search(name):
        return "entity_key"
    if _FINANCIAL_RE.search(name):
        return "financial_metric"
    if detected_type == "text":
        return "text"
    return "dimension"


def _infer_grain_suggestions(columns: list[ColumnProfile]) -> list[str]:
    """
    Heuristic grain suggestion: prefer entity_key + time_key combos.
    Falls back to high grain_score columns.
    """
    entity_keys = [c.name for c in columns if c.semantic_tag == "entity_key" and c.grain_candidate]
    time_keys = [c.name for c in columns if c.semantic_tag == "time_key"]
    high_grain = [c.name for c in columns if c.grain_candidate and c.semantic_tag not in ("time_key",)]

    # Prefer entity_key + time_key combo first
    suggestions = []
    if entity_keys:
        suggestions.extend(entity_keys[:2])
    if time_keys:
        suggestions.extend(time_keys[:1])
    # Add any remaining high-grain columns not already included
    for col in high_grain:
        if col not in suggestions:
            suggestions.append(col)
            if len(suggestions) >= 4:
                break

    return suggestions


def _serialize(values: list[Any]) -> list[Any]:
    """Convert numpy/pandas scalars to Python natives for Pydantic serialization."""
    result = []
    for v in values:
        if isinstance(v, pd.Timestamp):
            result.append(v.isoformat())
        elif hasattr(v, "item"):
            result.append(v.item())
        elif isinstance(v, float) and pd.isna(v):
            result.append(None)
        else:
            result.append(v)
    return result
