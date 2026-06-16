"""KPI suggestion service.

Scores all catalog KPIs for relevance against the confirmed schema of a dataset,
then optionally asks the AI to re-rank the top candidates with reasoning.
"""
import json
import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_AI_RERANK_TOP_N = 20
_AUTO_SELECT_THRESHOLD = 0.7
_DOMAIN_KEYWORDS = {
    "collections": re.compile(r"\b(collection|payment|debt|ptp|promise|arrears|contact|dial|penetrat)\b", re.I),
    "cx": re.compile(r"\b(cx|quality|qa|csat|nps|satisfaction|compliance|coaching|fcr)\b", re.I),
    "sales": re.compile(r"\b(sale|revenue|offer|close|convert|opportunit)\b", re.I),
    "workforce": re.compile(r"\b(workforce|attrition|adhere|schedule|hour|login|shrinkage|pvp)\b", re.I),
    "ops": re.compile(r"\b(ops|operation|process|handling|aht|occupancy|queue)\b", re.I),
}


def suggest(dataset_id: int, db: "Session", use_ai: bool = True) -> list[dict]:
    """Return a scored list of KPI suggestions for this dataset."""
    from models.column_schema import ColumnSchema
    from models.upload import Upload

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    upload_ids = [u.id for u in uploads]

    all_cols = db.query(ColumnSchema).filter(ColumnSchema.upload_id.in_(upload_ids)).all()
    col_names = [c.column_name for c in all_cols]

    # Build column → upload_id mapping so we can tag each KPI with its source fact
    col_to_upload: dict[str, int] = {c.column_name: c.upload_id for c in all_cols}
    # Group columns by upload for per-upload scoring
    upload_col_map: dict[int, list[str]] = {}
    for c in all_cols:
        upload_col_map.setdefault(c.upload_id, []).append(c.column_name)

    detected_domain = _infer_domain(col_names)

    catalog = _load_catalog()

    scored: list[dict] = []
    for kpi in catalog:
        score = _score_kpi(kpi, col_names, detected_domain)
        # Always include domain-matched KPIs; only require score > 0 for others
        if score > 0 or (detected_domain and kpi.get("domain") == detected_domain):
            effective_score = score if score > 0 else 0.1  # domain-only baseline
            match_count = _count_matches(kpi, col_names)
            if match_count > 0:
                reasoning = f"Matched {match_count} field(s) in your schema."
            elif detected_domain and kpi.get("domain") == detected_domain:
                reasoning = f"Relevant for {detected_domain} datasets."
            else:
                reasoning = "Potential match based on domain."
            # Find which upload best covers this KPI's source fields
            best_upload_id = _best_upload_for_kpi(kpi, upload_col_map)
            entry: dict = {
                "kpi_id": kpi["kpi_id"],
                "display_name": kpi["display_name"],
                "domain": kpi.get("domain", ""),
                "formula": _build_formula(kpi),
                "relevance_score": round(effective_score, 3),
                "reasoning": reasoning,
                "upload_id": best_upload_id,
            }
            if not kpi.get("reviewed", True):
                entry["is_contributed"] = True
            scored.append(entry)

    scored.sort(key=lambda x: x["relevance_score"], reverse=True)
    top = scored[:_AI_RERANK_TOP_N]

    # Always append user-contributed KPIs (reviewed=False) that the top-N cut
    # would otherwise discard. They have no source_fields so _score_kpi returns 0,
    # but they should remain discoverable on the KPI selection page.
    top_ids = {s["kpi_id"] for s in top}
    for kpi in catalog:
        if kpi.get("reviewed", True):
            continue  # skip official catalog entries
        if kpi["kpi_id"] in top_ids:
            continue  # already included via domain match
        top.append({
            "kpi_id": kpi["kpi_id"],
            "display_name": kpi["display_name"],
            "domain": kpi.get("domain", ""),
            "formula": _build_formula(kpi),
            "relevance_score": 0.5,
            "reasoning": "Contributed to your team's KPI registry — available for reuse.",
            "upload_id": None,
            "is_contributed": True,
        })

    if use_ai and top:
        try:
            top = _ai_rerank(top, col_names, detected_domain)
            # Restore upload_id after AI rerank (AI response won't include it)
            uid_map = {s["kpi_id"]: s.get("upload_id") for s in scored}
            for s in top:
                if s.get("upload_id") is None:
                    s["upload_id"] = uid_map.get(s["kpi_id"])
        except Exception as exc:
            logger.warning("AI KPI re-ranking failed (%s) — using score-based order.", exc)

    return top


def _load_catalog() -> list[dict]:
    """Load KPI catalog from DB, falling back to kpis.json if DB is empty."""
    from db.database import get_kpi_catalog
    catalog = get_kpi_catalog()
    if catalog:
        return catalog
    # Fallback: read directly from the JSON file
    import json, pathlib
    json_path = pathlib.Path(__file__).parent.parent / "catalog" / "kpis.json"
    if json_path.exists():
        with open(json_path, encoding="utf-8") as f:
            return json.load(f)
    return []


def _infer_domain(col_names: list[str]) -> str | None:
    text = " ".join(col_names).lower()
    best_domain = None
    best_count = 0
    for domain, pattern in _DOMAIN_KEYWORDS.items():
        count = len(pattern.findall(text))
        if count > best_count:
            best_count = count
            best_domain = domain
    return best_domain if best_count > 0 else None


def _score_kpi(kpi: dict, col_names: list[str], detected_domain: str | None) -> float:
    """Score a KPI against the dataset columns.

    Uses exact, substring, and token-overlap matching so that e.g. a column
    'qa_score' matches source field 'qa_score' and also a field 'score'.
    """
    source_fields: list[str] = kpi.get("source_fields", [])
    if not source_fields:
        return 0.0

    norm_cols = [_normalise(c) for c in col_names]
    norm_col_set = set(norm_cols)

    matched = 0
    for field in source_fields:
        nf = _normalise(field)
        # Exact match
        if nf in norm_col_set:
            matched += 1
            continue
        # Substring: column contains field or field contains column
        if any(nf in nc or nc in nf for nc in norm_cols if len(nf) >= 3 and len(nc) >= 3):
            matched += 0.6
            continue
        # Token overlap: share a significant word (≥4 chars)
        field_tokens = set(t for t in nf.split("_") if len(t) >= 4)
        if field_tokens and any(
            field_tokens & set(t for t in nc.split("_") if len(t) >= 4)
            for nc in norm_cols
        ):
            matched += 0.4

    if matched == 0:
        return 0.0

    # Normalise: cap at 1.0 even if many fields matched
    score = min(1.0, matched / max(1, len(source_fields)))

    # Domain bonus
    if detected_domain and kpi.get("domain") == detected_domain:
        score = min(1.0, score + 0.25)

    return score


def _count_matches(kpi: dict, col_names: list[str]) -> int:
    norm_col_set = {_normalise(c) for c in col_names}
    return sum(1 for f in kpi.get("source_fields", []) if _normalise(f) in norm_col_set)


def _normalise(name: str) -> str:
    return re.sub(r"[\s_\-]+", "_", name.strip().lower())


def _build_formula(kpi: dict) -> str:
    num = kpi.get("numerator", "")
    den = kpi.get("denominator", "_none_")
    if den == "_none_" or not den:
        return num
    return f"{num} / {den}"


def _best_upload_for_kpi(kpi: dict, upload_col_map: dict[int, list[str]]) -> int | None:
    """Return the upload_id whose columns best cover this KPI's source_fields."""
    source_fields = kpi.get("source_fields", [])
    if not source_fields or not upload_col_map:
        return None
    best_uid, best_score = None, -1
    for uid, cols in upload_col_map.items():
        score = _count_matches({"source_fields": source_fields}, cols)
        if score > best_score:
            best_score, best_uid = score, uid
    return best_uid if best_score > 0 else None


def resolve_kpi_formula(kpi: dict, col_names: list[str]) -> str | None:
    """Map catalog field names in a KPI entry to actual column names in the dataset.

    Returns a resolved formula string (e.g. 'mean(rubric_score)') or None if the
    primary source field cannot be matched to any available column.
    D1: called at /kpi-suggestions/select time so recipes store column-resolved formulas.
    """
    num_field = kpi.get("numerator", "")
    den_field = kpi.get("denominator", "_none_")

    resolved_num = _find_best_col_match(num_field, col_names)
    if not resolved_num:
        return None

    if den_field == "_none_" or not den_field:
        return f"mean({resolved_num})"

    # Compound denominator: "col_a + col_b" → mean(col_a) + mean(col_b)
    # Split on + before trying to match the whole string as a single column.
    den_parts = [p.strip() for p in re.split(r"\s*\+\s*", den_field) if p.strip()]
    if len(den_parts) > 1:
        resolved_parts = [_find_best_col_match(p, col_names) for p in den_parts]
        if all(resolved_parts):
            den_expr = " + ".join(f"mean({p})" for p in resolved_parts)
            return f"mean({resolved_num}) / ({den_expr})"
        # If any part fails to resolve, fall through to single-field attempt below

    resolved_den = _find_best_col_match(den_field, col_names)
    if not resolved_den:
        return None

    return f"mean({resolved_num}) / mean({resolved_den})"


def _find_best_col_match(field: str, col_names: list[str]) -> str | None:
    """Return the actual column name that best matches a catalog field name."""
    if not field or not col_names:
        return None

    nf = _normalise(field)
    norm_cols = [(_normalise(c), c) for c in col_names]

    # Exact match
    for nc, col in norm_cols:
        if nc == nf:
            return col

    # Substring match (field inside column or column inside field, min 3 chars)
    for nc, col in norm_cols:
        if len(nf) >= 3 and len(nc) >= 3 and (nf in nc or nc in nf):
            return col

    # Token overlap (shared meaningful token ≥ 4 chars)
    field_tokens = {t for t in nf.split("_") if len(t) >= 4}
    if field_tokens:
        for nc, col in norm_cols:
            col_tokens = {t for t in nc.split("_") if len(t) >= 4}
            if field_tokens & col_tokens:
                return col

    return None


def _ai_rerank(top_kpis: list[dict], col_names: list[str], detected_domain: str | None) -> list[dict]:
    from services.ai_client import chat_complete

    system = "You are a BI analyst. Re-rank KPIs by relevance to this dataset. Output ONLY valid JSON."
    user_msg = (
        f"Dataset columns: {json.dumps(col_names[:50])}\n"
        f"Detected domain: {detected_domain or 'unknown'}\n\n"
        f"KPI candidates:\n{json.dumps(top_kpis, indent=2)}\n\n"
        "For each KPI, provide a relevance_score (0.0–1.0) and a one-sentence reasoning.\n"
        "Return JSON:\n"
        '{"suggestions": [{"kpi_id": "...", "relevance_score": 0.9, "reasoning": "..."}]}'
    )

    raw = chat_complete(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        temperature=0.1,
        json_mode=True,
    )
    data = json.loads(raw)
    ai_map = {s["kpi_id"]: s for s in data.get("suggestions", [])}

    result = []
    for kpi in top_kpis:
        ai = ai_map.get(kpi["kpi_id"])
        if ai:
            result.append(
                {
                    **kpi,
                    "relevance_score": round(float(ai.get("relevance_score", kpi["relevance_score"])), 3),
                    "reasoning": ai.get("reasoning", kpi["reasoning"]),
                }
            )
        else:
            result.append(kpi)

    result.sort(key=lambda x: x["relevance_score"], reverse=True)
    return result
