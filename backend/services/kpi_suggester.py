"""
AI-driven KPI identification.

Replaces the old SequenceMatcher catalog-matching approach.

For each uploaded file the AI receives:
  - Column names and their profiler-detected types
  - 5-7 actual data rows from the staging table (or reconstructed from
    per-column sample_values when the staging table name is unavailable)

The AI then:
  1. Validates each column's true data type using both name patterns and
     sample values (catches Excel string-stored numbers, serial dates, etc.)
  2. Identifies every meaningful KPI computable from the available columns
  3. Returns formulas that reference the exact original column names

Returned suggestions are drop-in compatible with the rest of the pipeline:
  session_generator.py  → writes formulas into recipe config
  compute.py            → evaluates those formulas against the staging DataFrame
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from core.database import engine
from services.ai_client import chat_complete

logger = logging.getLogger(__name__)

_CATALOG_PATH = Path(__file__).parent.parent / "catalog" / "kpis.json"
_catalog_cache: list[dict] | None = None

# Formula patterns that compute.py/_eval_formula can handle
_FORMULA_GUIDE = """
Supported formula syntax (use ONLY these patterns):
  column_name                          → sum of that column
  mean(column_name)                    → average of that column
  sum(column_name)                     → explicit sum
  count(column_name)                   → non-null row count
  numerator_col / denominator_col      → ratio (compute.py evaluates this as ratio)
  numerator_col / (col_a + col_b)      → ratio with compound denominator

Aggregation rules — CRITICAL, follow exactly:
  - Columns containing "percent" or "pct" in their name → use mean(column_name)
  - Rating / score columns (csat, nps, score, rating) → use mean(column_name)
  - Ratio columns already stored as a fraction or 0–100 scale → use mean(column_name)
  - Count / volume / total columns → use sum(column_name) or count(column_name)
  - Computed ratios (numerator / denominator) → use col_a / col_b directly

Column name rules:
- Use the EXACT original column name (preserve case, spaces, special chars).
- Only reference columns confirmed present and numeric in this dataset.
- Do NOT invent column names that are not in the dataset.

Date handling:
- Dates stored as DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, or Excel serial (46110…) are DATE columns.
- Do NOT use date columns as KPI numerators or denominators.
"""


def _load_catalog() -> list[dict]:
    global _catalog_cache
    if _catalog_cache is None:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            _catalog_cache = json.load(f)
    return _catalog_cache


def _load_sample_rows(table_name: str, n: int = 7) -> list[dict]:
    """Load n rows from a staging table using LIMIT — avoids full-table scan."""
    try:
        with engine.connect() as conn:
            df = pd.read_sql(
                text(f'SELECT * FROM "{table_name}" LIMIT :n'),
                con=conn,
                params={"n": n},
            )
        return df.fillna("").to_dict(orient="records")
    except Exception as exc:
        logger.warning("kpi_suggester: could not load staging table %r: %s", table_name, exc)
        return []


def _reconstruct_sample_rows(columns: list[dict], n: int = 7) -> list[dict]:
    """
    Reconstruct row-oriented samples from per-column sample_values.

    Note: values from different columns may not be from the same physical row,
    but they are sufficient for the AI to infer data types and value ranges.
    """
    max_len = max((len(c.get("sample_values", [])) for c in columns), default=0)
    rows: list[dict] = []
    for i in range(min(max_len, n)):
        row = {}
        for col in columns:
            vals = col.get("sample_values", [])
            if i < len(vals) and vals[i] is not None:
                row[col["name"]] = vals[i]
        if row:
            rows.append(row)
    return rows


def _build_prompt(file_contexts: list[dict], interview_answers: dict) -> str:
    catalog = _load_catalog()

    # Build a rich catalog reference with source_fields + aliases so the AI can
    # match standard KPIs to the actual column names in the dataset.
    catalog_lines: list[str] = []
    for k in catalog:
        fields = k.get("source_fields", [])
        aliases = k.get("aliases", [])
        fmt = k.get("format", "decimal")
        catalog_lines.append(
            f"  {k['kpi_id']} | {k['display_name']} [{k['domain']}] | "
            f"format={fmt} | source_fields={fields} | aliases={aliases}"
        )
    catalog_ref = "\n".join(catalog_lines)

    domain_hint = (
        interview_answers.get("domain") or interview_answers.get("q1") or ""
    ).strip()
    domain_context = f"\nBusiness context: {domain_hint}\n" if domain_hint else ""

    file_blocks: list[str] = []
    for ctx in file_contexts:
        col_lines = "\n".join(
            f"  {c['name']}  |  {c.get('detected_type', 'unknown')}  |  "
            f"samples: {c.get('sample_values', [])[:4]}"
            for c in ctx["columns"]
        )
        row_lines = "\n".join(
            json.dumps(r, default=str) for r in ctx["sample_rows"][:7]
        )
        file_blocks.append(
            f"=== File: {ctx['filename']} ===\n"
            f"Columns  (name | profiler_type | first 4 sample values):\n{col_lines}\n\n"
            f"Sample rows (actual data — use to validate data types and value ranges):\n{row_lines}"
        )

    files_section = "\n\n".join(file_blocks)

    return f"""You are given one or more operational datasets. Return ALL meaningful KPIs computable from the available columns.
{domain_context}
{files_section}

Standard KPI catalog (kpi_id | display_name [domain] | format | source_fields | aliases):
{catalog_ref}

Instructions — follow ALL steps in order:

STEP 1 — Validate data types using sample values:
  - Values like "01-01-2024", "31/12/2023", "2024-01-01" → DATE column (skip as KPI input)
  - Values like 46110, 46111 → Excel serial DATE column (skip as KPI input)
  - Column name contains "id", "ref", "key", "code", "uuid" → IDENTIFIER column (skip)
  - Column name contains "email", "phone", "address", "name" → PII TEXT column (skip)
  - All remaining numeric columns are eligible KPI inputs.

STEP 2 — Match catalog KPIs to this dataset:
  For EACH catalog entry whose source_fields or aliases match any column in this dataset
  (use fuzzy/partial matching — e.g. "contacts" matches "total_contacts", "live_contacts"):
  - Suggest that KPI with the formula adapted to the EXACT actual column names found.
  - If the catalog formula requires multiple columns, only suggest it if ALL required columns exist.
  - Use the catalog's format field directly.

STEP 3 — Suggest additional KPIs from remaining columns:
  For numeric columns NOT covered by catalog KPIs:
  - Suggest any meaningful KPI (sum, mean, ratio) derivable from those columns.
  - Infer format from column name: "percent"/"pct"/"rate" → percentage, "amount"/"revenue" → currency, etc.

STEP 4 — Apply correct aggregation for each KPI:
  - "percent" or "pct" in column name → mean(column_name) and format=percentage
  - "rating", "score", "csat", "nps" in column name → mean(column_name) and format=decimal
  - "count", "total", "volume" → sum(column_name) and format=integer
  - Ratio of two columns → numerator_col / denominator_col

STEP 5 — Remove duplicates: if two suggestions have the same formula (ignoring whitespace),
  keep only the one with the higher confidence.

{_FORMULA_GUIDE}

Return ONLY a valid JSON array — no markdown fences, no explanation:
[
  {{
    "kpi_id": "snake_case_id",
    "display_name": "Human Readable Name",
    "description": "One sentence.",
    "formula": "exact_col / another_exact_col",
    "aggregation": "sum | average | ratio_of_sums | (leave empty for plain ratio)",
    "format": "percentage | integer | currency | duration | decimal",
    "domain": "collections | cx | sales | workforce | ops",
    "confidence": 0.95,
    "catalog_match": "kpi_id from catalog, or empty string if not a catalog KPI"
  }}
]"""


def _parse_ai_response(raw: str) -> list[dict]:
    """Parse the AI JSON into standardised KPI suggestion dicts."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("kpi_suggester: AI returned non-JSON response: %.200s", raw)
        return []

    # Some models wrap the array in {"kpis": [...]} or {"suggestions": [...]}
    if isinstance(data, dict):
        data = data.get("kpis") or data.get("suggestions") or list(data.values())
    if not isinstance(data, list):
        return []

    results: list[dict] = []
    seen_ids: set[str] = set()
    seen_formulas: set[str] = set()

    for item in data:
        if not isinstance(item, dict):
            continue
        kpi_id = str(item.get("kpi_id") or "").strip()
        formula = str(item.get("formula") or "").strip()
        if not kpi_id or not formula:
            continue

        # Deduplicate by kpi_id
        if kpi_id in seen_ids:
            continue
        # Deduplicate by normalised formula (whitespace + case stripped)
        formula_norm = re.sub(r"\s+", "", formula.lower())
        if formula_norm in seen_formulas:
            logger.info("kpi_suggester: dropped duplicate formula %r (%r)", formula, kpi_id)
            continue

        seen_ids.add(kpi_id)
        seen_formulas.add(formula_norm)
        results.append({
            "kpi_id": kpi_id,
            "display_name": item.get("display_name") or kpi_id.replace("_", " ").title(),
            "formula": formula,
            "confidence": float(item.get("confidence") or 0.9),
            "matched_columns": {},
            "source": "ai",
            "domain": str(item.get("domain") or ""),
            "description": str(item.get("description") or ""),
            "aggregation": str(item.get("aggregation") or ""),
            "format": str(item.get("format") or ""),
            "catalog_match": str(item.get("catalog_match") or ""),
        })

    results.sort(key=lambda r: -r["confidence"])
    return results


def _filter_valid_formulas(suggestions: list[dict], col_names: list[str]) -> list[dict]:
    """
    Discard AI suggestions whose formula doesn't reference any real column.

    Normalises column names (lowercase + underscores) for comparison so that
    'Avg Handle Time' matches 'avg_handle_time' in a formula.
    """
    if not col_names:
        return suggestions

    # Build lookup: original name, lowercased, and underscore-normalised
    lookup: set[str] = set()
    for c in col_names:
        lookup.add(c)
        lookup.add(c.lower())
        lookup.add(re.sub(r"[^a-z0-9]+", "_", c.lower()).strip("_"))

    AGG_FUNCS = {"mean", "avg", "average", "sum", "count"}

    valid: list[dict] = []
    for s in suggestions:
        formula = s.get("formula", "")
        # Extract all word-like tokens (handles both snake_case and "Spaced Names")
        tokens: set[str] = set()
        for tok in re.findall(r"[A-Za-z][A-Za-z0-9_ ]*[A-Za-z0-9]|[A-Za-z][A-Za-z0-9]*", formula):
            tokens.add(tok)
            tokens.add(tok.lower())
            tokens.add(re.sub(r"[^a-z0-9]+", "_", tok.lower()).strip("_"))
        tokens -= AGG_FUNCS
        if tokens & lookup:
            valid.append(s)
        else:
            logger.info(
                "kpi_suggester: dropped %r — formula %r references no known column",
                s.get("kpi_id"), formula,
            )
    return valid


def _col_formula(col: str, fmt: str) -> str:
    """Return the aggregation formula for a single column based on its format."""
    if fmt in ("percentage", "decimal"):
        return f"mean({col})"
    return col  # integer / currency → sum via plain column name


def _catalog_fallback(col_names: list[str]) -> list[dict]:
    """
    SequenceMatcher fallback: match catalog source_fields against actual column names.

    Called when the AI call fails or returns no valid suggestions, so users
    always see something useful instead of an empty list.
    """
    from difflib import SequenceMatcher

    if not col_names:
        return []

    catalog = _load_catalog()

    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

    norm_map: dict[str, str] = {_norm(c): c for c in col_names}

    def _best_col(fields: list[str]) -> tuple[str | None, float]:
        best_col, best_score = None, 0.0
        for field in fields:
            nf = _norm(field)
            for nc, orig in norm_map.items():
                if nf == nc:
                    return orig, 1.0
                score = SequenceMatcher(None, nf, nc).ratio()
                if score > best_score and score >= 0.55:
                    best_col, best_score = orig, score
        return best_col, best_score

    results: list[dict] = []
    seen: set[str] = set()

    for kpi in catalog:
        source_fields = kpi.get("source_fields", [])
        num_col, num_score = _best_col(source_fields)
        if not num_col:
            continue

        fmt = kpi.get("format", "decimal")
        den_raw = kpi.get("denominator", "_none_")

        if den_raw and den_raw != "_none_":
            den_col, den_score = _best_col([den_raw])
            if den_col and den_col != num_col:
                formula = f"{num_col} / {den_col}"
                conf = round(min(num_score, den_score) * 0.9, 2)
            else:
                formula = _col_formula(num_col, fmt)
                conf = round(num_score * 0.65, 2)
        else:
            formula = _col_formula(num_col, fmt)
            conf = round(num_score, 2)

        key = re.sub(r"\s+", "", formula.lower())
        if key in seen:
            continue
        seen.add(key)

        results.append({
            "kpi_id": kpi["kpi_id"],
            "display_name": kpi["display_name"],
            "formula": formula,
            "confidence": conf,
            "matched_columns": {num_col: "source"},
            "source": "catalog",
            "domain": kpi.get("domain", "ops"),
            "description": kpi.get("description", ""),
            "aggregation": "ratio_of_sums" if "/" in formula else "",
            "format": fmt,
            "catalog_match": kpi["kpi_id"],
        })

    results.sort(key=lambda r: -r["confidence"])
    logger.info("kpi_suggester: catalog fallback matched %d KPIs from %d columns", len(results), len(col_names))
    return results[:25]


def suggest(profiles: list[dict], interview_answers: dict) -> list[dict]:
    """
    AI-driven KPI suggestion with catalog fallback.

    Sends column names + data samples to the LLM and asks it to identify
    computable KPIs. If the AI call fails or returns nothing valid, falls back
    to SequenceMatcher against catalog source_fields so users always see KPIs.
    """
    if not profiles:
        return []

    file_contexts: list[dict] = []
    for profile in profiles:
        columns = profile.get("columns", [])
        filename = profile.get("filename", "dataset")
        staging_table_name = profile.get("staging_table_name")

        # Defensive: skip columns without a name
        col_info = [
            {
                "name": c["name"],
                "detected_type": c.get("detected_type", "unknown"),
                "sample_values": [
                    v for v in c.get("sample_values", []) if v is not None
                ][:5],
            }
            for c in columns
            if c.get("name")
        ]

        sample_rows = (
            _load_sample_rows(staging_table_name)
            if staging_table_name
            else _reconstruct_sample_rows(col_info)
        )

        file_contexts.append(
            {
                "filename": filename,
                "columns": col_info,
                "sample_rows": sample_rows,
            }
        )

    all_col_names = [c["name"] for ctx in file_contexts for c in ctx["columns"]]

    prompt = _build_prompt(file_contexts, interview_answers)

    ai_failed = False
    try:
        raw = chat_complete(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a BI analyst specialising in contact-centre and collections reporting. "
                        "Respond with valid JSON only — no markdown, no explanation."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            json_mode=True,
        )
        suggestions = _parse_ai_response(raw)
        suggestions = _filter_valid_formulas(suggestions, all_col_names)
        logger.info(
            "kpi_suggester: AI returned %d valid suggestions for %d file(s)",
            len(suggestions),
            len(profiles),
        )
    except Exception as exc:
        logger.error("kpi_suggester: AI call failed (%s) — using catalog fallback", exc)
        suggestions = []
        ai_failed = True

    if not suggestions:
        # M14: Distinguish API failure from genuinely no matching suggestions
        if ai_failed:
            logger.info("kpi_suggester: AI failed — falling back to catalog")
        else:
            logger.info("kpi_suggester: AI returned no valid suggestions — falling back to catalog")
        suggestions = _catalog_fallback(all_col_names)

    return suggestions
