"""AI-enhanced schema mapping service.

Converts profiler.py's 4-type output (date/numeric/categorical/text) to a
more granular 5-type system (int/float/boolean/text/date) and determines
which columns are filter candidates. Writes results to column_schemas table.

AI enhancement pass is optional: if ai_client is unavailable or returns an
error the rule-based classification is used as-is.
"""
import json
import logging
import re

import pandas as pd

# Column name patterns that signal ordinal measures (scores/ratings with low cardinality)
_ORDINAL_MEASURE_HINTS = re.compile(
    r"\b(score|rating|grade|satisfaction|stars|points|mark|rubric|csat|nps|effort|sentiment|rank|level)\b",
    re.IGNORECASE,
)

from schemas.upload import ColumnProfile, ProfilingResult

logger = logging.getLogger(__name__)

# Confidence used for rule-based suggestions (no AI pass)
_RULE_CONFIDENCE = 0.85
# Confidence threshold below which AI override is ignored
_AI_CONFIDENCE_THRESHOLD = 0.7
# Max unique values for a dimension column to be a filter candidate
_MAX_FILTER_UNIQUES = 50


# ── Public interface ──────────────────────────────────────────────────────────

def suggest_from_profile(
    profile: ProfilingResult,
    df: pd.DataFrame,
    upload_id: int,
    filename: str,
    use_ai: bool = True,
) -> list[dict]:
    """Return a list of column schema dicts ready to be written to the DB.

    Each dict corresponds to one ColumnSchema row.
    """
    # Step 1: rule-based classification
    rule_based = [_rule_classify(col, df) for col in profile.columns]

    # Step 2: optional AI enhancement pass
    if use_ai:
        try:
            ai_suggestions = _ai_enhance(rule_based, filename)
            rule_based = _merge_ai(rule_based, ai_suggestions)
        except Exception as exc:
            logger.warning("AI schema enhancement failed (%s) — using rule-based only.", exc)

    # Step 3: build DB-ready dicts
    rows = []
    for col_profile, classified in zip(profile.columns, rule_based):
        rows.append(
            {
                "upload_id": upload_id,
                "column_name": col_profile.name,
                "raw_dtype": col_profile.raw_dtype,
                "ai_detected_type": classified["detected_type"],
                "ai_role": classified["role"],
                "ai_is_filter": classified["is_filter_candidate"],
                "ai_confidence": classified["confidence"],
                "confirmed_type": None,
                "confirmed_role": None,
                "confirmed_is_filter": None,
                "unique_count": col_profile.unique_count,
                "missing_pct": col_profile.missing_pct,
                "sample_values": col_profile.sample_values,
            }
        )
    return rows


def apply_overrides(
    upload_id: int,
    overrides: list[dict],
    db,
) -> None:
    """Write user overrides into column_schemas.confirmed_* fields."""
    from models.column_schema import ColumnSchema

    override_map = {o["column_name"]: o for o in overrides}
    cols = db.query(ColumnSchema).filter(ColumnSchema.upload_id == upload_id).all()

    for col in cols:
        if col.column_name in override_map:
            o = override_map[col.column_name]
            if o.get("detected_type") is not None:
                col.confirmed_type = o["detected_type"]
            if o.get("role") is not None:
                col.confirmed_role = o["role"]
            if o.get("is_filter_candidate") is not None:
                col.confirmed_is_filter = o["is_filter_candidate"]

    db.flush()


# ── Rule-based classification ─────────────────────────────────────────────────

def _rule_classify(col: ColumnProfile, df: pd.DataFrame) -> dict:
    detected_type = _map_to_5type(col, df)
    role = _infer_role(detected_type, col)
    is_filter = _is_filter_candidate(detected_type, role, col.unique_count)
    return {
        "column_name": col.name,
        "detected_type": detected_type,
        "role": role,
        "is_filter_candidate": is_filter,
        "confidence": _RULE_CONFIDENCE,
    }


def _map_to_5type(col: ColumnProfile, df: pd.DataFrame) -> str:
    if col.detected_type == "date":
        return "date"

    if col.detected_type == "numeric":
        raw_dtype = str(df[col.name].dtype) if col.name in df.columns else col.raw_dtype
        # Integer dtype variants
        if any(raw_dtype.startswith(p) for p in ("int", "uint", "Int", "UInt")):
            return "int"
        return "float"

    if col.detected_type in ("categorical", "text"):
        # Boolean-like: ≤3 distinct values that look like yes/no/true/false/0/1
        if col.unique_count <= 3:
            if col.name in df.columns:
                distinct = {str(v).lower().strip() for v in df[col.name].dropna().unique()}
                bool_values = {"0", "1", "true", "false", "yes", "no", "y", "n", "t", "f"}
                if distinct.issubset(bool_values):
                    return "boolean"
        # Categorical stays → maps to "text" in 5-type unless it's numeric-looking
        if col.detected_type == "text":
            return "text"
        # categorical → try int/float
        if col.name in df.columns:
            sample = df[col.name].dropna().head(50)
            try:
                pd.to_numeric(sample)
                if sample.astype(str).str.contains(r"\.", regex=True).any():
                    return "float"
                return "int"
            except (ValueError, TypeError):
                pass
        return "text"

    return "text"


def _infer_role(detected_type: str, col: ColumnProfile) -> str:
    if detected_type == "date":
        return "date"
    if detected_type == "boolean":
        return "boolean"
    if detected_type in ("int", "float"):
        # B2: Ordinal measure — low cardinality numeric whose name signals a score/rating.
        # Check this BEFORE the generic low-cardinality→dimension rule so that
        # avg_csat_rating (unique=5), rubric_score, etc. are correctly kept as measures.
        if col.unique_count <= 10 and _ORDINAL_MEASURE_HINTS.search(col.name):
            return "measure"
        # Low cardinality numeric → treat as dimension (e.g. status codes, flag columns)
        if col.unique_count <= 5:
            return "dimension"
        return "measure"
    # text — use original profiler suggestion
    if col.suggested_role == "dimension":
        return "dimension"
    return "dimension"


def _is_filter_candidate(detected_type: str, role: str, unique_count: int) -> bool:
    if role != "dimension":
        return False
    if detected_type == "date":
        return False
    return unique_count <= _MAX_FILTER_UNIQUES


# ── AI enhancement pass ───────────────────────────────────────────────────────

def _ai_enhance(rule_based: list[dict], filename: str) -> list[dict]:
    from services.ai_client import chat_complete

    # Build compact column summary for the prompt
    col_summaries = [
        {
            "name": c["column_name"],
            "rule_type": c["detected_type"],
            "rule_role": c["role"],
            "rule_is_filter": c["is_filter_candidate"],
        }
        for c in rule_based
    ]

    system = (
        "You are a data analyst. Classify each column from the uploaded file. "
        "Output ONLY valid JSON — no commentary."
    )
    user_msg = (
        f"File: {filename}\n\n"
        f"Rule-based classification (for context):\n{json.dumps(col_summaries, indent=2)}\n\n"
        "For each column, confirm or correct the classification. "
        "Rules:\n"
        "- detected_type: int | float | boolean | text | date\n"
        "- role: measure | date | dimension | boolean\n"
        "- is_filter_candidate: true only when role=dimension AND likely ≤50 unique values\n"
        "- confidence: 0.0–1.0 (how confident you are in your answer)\n\n"
        "Return JSON:\n"
        '{"columns": [{"name": "...", "detected_type": "...", "role": "...", '
        '"is_filter_candidate": true, "confidence": 0.9}]}'
    )

    raw = chat_complete(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        temperature=0.1,
        json_mode=True,
    )
    data = json.loads(raw)
    return data.get("columns", [])


def _merge_ai(rule_based: list[dict], ai_suggestions: list[dict]) -> list[dict]:
    ai_map = {s["name"]: s for s in ai_suggestions}
    merged = []
    for rb in rule_based:
        ai = ai_map.get(rb["column_name"])
        if ai and float(ai.get("confidence", 0)) >= _AI_CONFIDENCE_THRESHOLD:
            # Only accept AI override when it differs from rule-based
            merged.append(
                {
                    "column_name": rb["column_name"],
                    "detected_type": ai.get("detected_type", rb["detected_type"]),
                    "role": ai.get("role", rb["role"]),
                    "is_filter_candidate": ai.get("is_filter_candidate", rb["is_filter_candidate"]),
                    "confidence": float(ai.get("confidence", rb["confidence"])),
                }
            )
        else:
            merged.append(rb)
    return merged
