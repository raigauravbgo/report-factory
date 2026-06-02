from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

_CATALOG_PATH = Path(__file__).parent.parent / "catalog" / "kpis.json"


def validate(staging_tables: list, selected_kpi_ids: list[str], db: Session) -> dict:
    """
    Run pre-dashboard data quality checks.
    Returns { errors: [...], warnings: [...], passed: bool }
    """
    catalog = _load_catalog()
    kpi_map = {k["kpi_id"]: k for k in catalog}

    errors: list[dict] = []
    warnings: list[dict] = []

    for staging in staging_tables:
        profile = staging.profile_data or {}
        columns = {c["name"]: c for c in profile.get("columns", [])}

        # Check each selected KPI
        for kpi_id in selected_kpi_ids:
            kpi = kpi_map.get(kpi_id)
            if not kpi:
                continue

            denom_field = kpi.get("denominator", "")
            matched_col = _find_col(denom_field, columns)

            if matched_col:
                col_profile = columns[matched_col]
                # Division by zero risk: very high missing or all-zero values
                if col_profile.get("missing_pct", 0) > 80:
                    errors.append({
                        "severity": "error",
                        "column": matched_col,
                        "message": (
                            f"KPI '{kpi.get('display_name', kpi_id)}': denominator column '{matched_col}' "
                            f"is {col_profile['missing_pct']}% missing — division by zero risk."
                        ),
                    })
                elif col_profile.get("missing_pct", 0) > 20:
                    warnings.append({
                        "severity": "warning",
                        "column": matched_col,
                        "message": (
                            f"KPI '{kpi.get('display_name', kpi_id)}': denominator '{matched_col}' "
                            f"has {col_profile['missing_pct']}% missing values."
                        ),
                    })

        # High null check on measure columns
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
        row_count = profile.get("row_count", 1)
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
            elif dupe_count > 0:
                warnings.append({
                    "severity": "warning",
                    "column": ", ".join(grain_cols),
                    "message": f"{dupe_count:,} duplicate rows detected in grain columns.",
                })

        # Date column gap check
        for col_name, col_profile in columns.items():
            if col_profile.get("detected_type") == "date":
                # We don't load the actual data here — surface as advisory
                warnings.append({
                    "severity": "warning",
                    "column": col_name,
                    "message": (
                        f"Date column '{col_name}' not verified for gaps. "
                        "Gaps > 30 days will show as breaks in trend charts."
                    ),
                })
                break  # One advisory per file is enough

    passed = len(errors) == 0

    return {
        "errors": errors,
        "warnings": warnings,
        "passed": passed,
    }


def _find_col(field_name: str, columns: dict) -> str | None:
    """Fuzzy match a KPI field name against available column names."""
    from difflib import SequenceMatcher

    best_score = 0.0
    best_col = None
    for col_name in columns:
        score = SequenceMatcher(None, field_name.lower(), col_name.lower()).ratio()
        if score > best_score:
            best_score = score
            best_col = col_name
    return best_col if best_score > 0.6 else None


def _load_catalog() -> list[dict]:
    with open(_CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)
