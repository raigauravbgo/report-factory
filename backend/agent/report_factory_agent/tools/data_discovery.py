import sys
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import get_kpi_catalog, get_report, get_schema_memory, update_report


def _fuzzy_score(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def run_data_discovery(request_id: str, file_path: str) -> dict:
    """
    Reads the uploaded Excel file, extracts headers and sample rows, and
    produces a fuzzy-matched column mapping draft for the KPIs in the intake spec.

    Args:
        request_id: The report request ID.
        file_path: Absolute path to the uploaded Excel file.

    Returns:
        Dict with headers, sample rows, and a column_mapping draft.
        Mapping items with confidence < 0.7 have needs_review = true.
    """
    report = get_report(request_id)
    if not report:
        return {"error": f"Report {request_id} not found."}

    intake_spec = report.get("intake_spec")
    if not intake_spec:
        return {"error": "Intake not yet complete. Run intake first."}

    kpi_list: list[str] = intake_spec.get("kpi_list", [])

    # Parse file
    try:
        df = pd.read_excel(file_path, nrows=5)
        full_df = pd.read_excel(file_path)
    except Exception as exc:
        return {"error": f"Could not read Excel file: {exc}"}

    headers = list(df.columns)
    sample = df.head(3).to_dict(orient="records")
    row_count = len(full_df)

    # Check schema memory — skip fuzzy match if approved mapping exists for this client+template
    client_id = intake_spec.get("client_id", "")
    template_type = intake_spec.get("template_type", "")
    memory = get_schema_memory(client_id, template_type) if client_id and template_type else None

    if memory:
        stored: dict = memory.get("mappings", {})
        # Validate stored columns still exist in this file's headers
        valid = {kpi: m for kpi, m in stored.items() if m.get("raw_column") in headers}
        if len(valid) == len(kpi_list):
            column_mapping = {kpi: {**m, "source": "schema_memory"} for kpi, m in valid.items()}
            update_report(request_id, file_path=file_path, column_mapping=column_mapping, status="awaiting_mapping_confirmation")
            return {
                "status": "data_discovery_complete",
                "source": "schema_memory",
                "headers": headers,
                "row_count": row_count,
                "sample": sample,
                "column_mapping": column_mapping,
                "needs_review_count": 0,
                "message": "Schema memory found — previous approved mapping applied. Confirm to proceed (or adjust if headers changed).",
            }

    # Fuzzy-match headers → KPI source fields
    catalog = get_kpi_catalog()
    kpi_defs = {k["kpi_id"]: k for k in catalog if k["kpi_id"] in kpi_list}

    column_mapping: dict[str, dict] = {}
    for kpi_id, kpi_def in kpi_defs.items():
        candidates = list(kpi_def.get("source_fields", []))
        candidates += [kpi_def["numerator"], kpi_def["denominator"]]
        candidates += kpi_def.get("aliases", [])

        best_match: str | None = None
        best_score: float = 0.0
        for header in headers:
            for candidate in candidates:
                if candidate == "_none_":
                    continue
                score = _fuzzy_score(header, candidate)
                if score > best_score:
                    best_score = score
                    best_match = header

        column_mapping[kpi_id] = {
            "raw_column": best_match,
            "confidence": round(best_score, 2),
            "needs_review": best_score < 0.7,
        }

    update_report(
        request_id,
        file_path=file_path,
        column_mapping=column_mapping,
        status="awaiting_mapping_confirmation",
    )

    needs_review_count = sum(1 for v in column_mapping.values() if v["needs_review"])

    return {
        "status": "data_discovery_complete",
        "headers": headers,
        "row_count": row_count,
        "sample": sample,
        "column_mapping": column_mapping,
        "needs_review_count": needs_review_count,
        "message": (
            f"{needs_review_count} mapping(s) need user confirmation (confidence < 0.7)."
            if needs_review_count
            else "All mappings auto-resolved. Please confirm to proceed."
        ),
    }
