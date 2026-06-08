from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy.orm import Session

_CATALOG_PATH = Path(__file__).parent.parent / "catalog" / "kpis.json"


def validate(
    staging_tables: list,
    selected_kpi_ids: list[str],
    db: Session,
    selected_kpis: list[dict] | None = None,
) -> dict:
    """
    Run pre-dashboard data quality checks.

    Accepts two forms of KPI input:
    - selected_kpi_ids  : list of catalog kpi_id strings (legacy single-file flow)
    - selected_kpis     : list of full KPI dicts from AI suggestions (new flow),
                          each with at minimum {"kpi_id", "display_name", "formula"}

    Returns { errors: [...], warnings: [...], passed: bool }
    """
    catalog = _load_catalog()
    kpi_map = {k["kpi_id"]: k for k in catalog}

    # Normalise both input forms into a unified list of check-dicts:
    #   { "display_name": str, "denominator_cols": [str, ...] }
    kpis_to_check: list[dict] = []

    # Legacy: catalog-referenced KPIs
    for kpi_id in (selected_kpi_ids or []):
        kpi = kpi_map.get(kpi_id)
        if not kpi:
            continue
        den = kpi.get("denominator", "")
        if den and den != "_none_":
            kpis_to_check.append({
                "display_name": kpi.get("display_name", kpi_id),
                "denominator_cols": [den],
            })

    # New: AI-generated KPIs — extract denominator column(s) from the formula
    for kpi in (selected_kpis or []):
        if not isinstance(kpi, dict):
            continue
        formula = str(kpi.get("formula") or "")
        display_name = str(kpi.get("display_name") or kpi.get("kpi_id") or "")
        den_cols = _denominator_cols_from_formula(formula)
        if den_cols:
            kpis_to_check.append({
                "display_name": display_name,
                "denominator_cols": den_cols,
            })

    errors: list[dict] = []
    warnings: list[dict] = []

    for staging in staging_tables:
        profile = staging.profile_data or {}
        columns = {c["name"]: c for c in profile.get("columns", [])}

        # KPI-level denominator checks
        for kpi_check in kpis_to_check:
            for den_field in kpi_check["denominator_cols"]:
                matched_col = _find_col(den_field, columns)
                if not matched_col:
                    continue
                col_profile = columns[matched_col]
                missing_pct = col_profile.get("missing_pct", 0)
                if missing_pct > 80:
                    errors.append({
                        "severity": "error",
                        "column": matched_col,
                        "message": (
                            f"KPI '{kpi_check['display_name']}': denominator column '{matched_col}' "
                            f"is {missing_pct}% missing — division by zero risk."
                        ),
                    })
                elif missing_pct > 20:
                    warnings.append({
                        "severity": "warning",
                        "column": matched_col,
                        "message": (
                            f"KPI '{kpi_check['display_name']}': denominator '{matched_col}' "
                            f"has {missing_pct}% missing values."
                        ),
                    })

        # High null check on all measure columns
        for col_name, col_profile in columns.items():
            if col_profile.get("suggested_role") == "measure":
                pct = col_profile.get("missing_pct", 0)
                if pct > 20:
                    warnings.append({
                        "severity": "warning",
                        "column": col_name,
                        "message": f"Measure column '{col_name}' has {pct}% missing values.",
                    })

        # Duplicate grain key check
        dupe_count = profile.get("duplicate_row_count", 0)
        row_count = profile.get("row_count", 1) or 1
        grain_cols = staging.grain_columns or profile.get("grain_suggestions", [])
        if grain_cols and dupe_count > 0:
            dupe_pct = round(dupe_count / row_count * 100, 1)
            if dupe_pct > 5:
                errors.append({
                    "severity": "error",
                    "column": ", ".join(grain_cols),
                    "message": (
                        f"Duplicate rows detected in grain key columns ({grain_cols}): "
                        f"{dupe_count:,} duplicate rows ({dupe_pct}%). "
                        "This may cause double-counting in KPI calculations."
                    ),
                })
            else:
                warnings.append({
                    "severity": "warning",
                    "column": ", ".join(grain_cols),
                    "message": f"{dupe_count:,} duplicate rows detected in grain columns.",
                })

    return {
        "errors": errors,
        "warnings": warnings,
        "passed": len(errors) == 0,
    }


def _denominator_cols_from_formula(formula: str) -> list[str]:
    """
    Extract denominator column name(s) from a KPI formula string.

    Handles:
      - Simple ratio:           col_a / col_b            → ["col_b"]
      - Compound denominator:   col_a / (col_b + col_c)  → ["col_b", "col_c"]
      - No denominator:         col_a  or  mean(col_a)   → []
    """
    if "/" not in formula:
        return []
    _, den_part = formula.split("/", 1)
    # Strip outer whitespace and parentheses
    den_clean = den_part.strip().strip("()")
    # M7: Split on +, -, * to handle all compound denominator forms
    # e.g. col_a / (col_b - col_c) or col_a / (col_b * col_c)
    parts = [p.strip() for p in re.split(r"\s*[+\-*]\s*", den_clean) if p.strip()]
    return parts


def _find_col(field_name: str, columns: dict) -> str | None:
    """
    Match a field name against available column names.

    Tries exact match first, then case-insensitive, then SequenceMatcher
    fuzzy match with a 0.6 threshold.
    """
    if field_name in columns:
        return field_name
    lower = field_name.lower()
    for col in columns:
        if col.lower() == lower:
            return col
    from difflib import SequenceMatcher
    best_score = 0.0
    best_col = None
    for col_name in columns:
        score = SequenceMatcher(None, lower, col_name.lower()).ratio()
        if score > best_score:
            best_score = score
            best_col = col_name
    return best_col if best_score > 0.6 else None


def _load_catalog() -> list[dict]:
    with open(_CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)
