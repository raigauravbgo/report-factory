import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import get_kpi_catalog, get_report, log_agent_step, update_report


def run_standardise(request_id: str, confirmed_mapping: dict | None = None) -> dict:
    """
    Applies the confirmed column mapping, computes KPI values, and runs range validation.

    Args:
        request_id: The report request ID.
        confirmed_mapping: Optional overrides to the auto-generated mapping.
            Format: {kpi_id: {"numerator_column": str, "denominator_column": str}}
            If None, uses the mapping already stored on the report (after data_discovery).

    Returns:
        computed_kpis dict and data_quality_flags list.
    """
    t0 = time.time()
    report = get_report(request_id)
    if not report:
        return {"error": f"Report {request_id} not found."}

    intake_spec = report.get("intake_spec", {})
    kpi_list: list[str] = intake_spec.get("kpi_list", [])
    file_path = report.get("file_path")

    if not file_path:
        return {"error": "No file uploaded. Run data_discovery first."}

    # Use confirmed_mapping if provided, otherwise use stored mapping
    stored_mapping: dict = report.get("column_mapping") or {}
    if confirmed_mapping:
        # Merge: confirmed_mapping overrides stored_mapping per kpi_id
        for kpi_id, override in confirmed_mapping.items():
            stored_mapping[kpi_id] = {**stored_mapping.get(kpi_id, {}), **override}
        update_report(request_id, column_mapping=stored_mapping)

    try:
        df = pd.read_excel(file_path)
    except Exception as exc:
        return {"error": f"Could not read Excel file: {exc}"}

    catalog = {k["kpi_id"]: k for k in get_kpi_catalog() if k["kpi_id"] in kpi_list}
    computed_kpis: dict = {}
    flags: list[str] = []

    for kpi_id in kpi_list:
        kpi_def = catalog.get(kpi_id)
        if not kpi_def:
            flags.append(f"{kpi_id}: not found in catalog")
            continue

        mapping = stored_mapping.get(kpi_id, {})
        denominator_field = kpi_def.get("denominator", "")

        # Pure sum/count KPI — no division
        if denominator_field == "_none_":
            num_col = mapping.get("numerator_column") or mapping.get("raw_column")
            if not num_col or num_col not in df.columns:
                flags.append(f"{kpi_id}: column '{num_col}' not found in file")
                computed_kpis[kpi_id] = {"value": None, "flags": [f"column '{num_col}' missing"]}
                continue
            value = float(df[num_col].sum())
            computed_kpis[kpi_id] = {"value": round(value, 4), "flags": []}
            continue

        # Ratio KPI — numerator / denominator
        num_col = mapping.get("numerator_column") or mapping.get("raw_column")
        den_col = mapping.get("denominator_column")

        if not num_col or num_col not in df.columns:
            flags.append(f"{kpi_id}: numerator column '{num_col}' not found")
            computed_kpis[kpi_id] = {"value": None, "flags": [f"numerator column '{num_col}' missing"]}
            continue
        if not den_col or den_col not in df.columns:
            flags.append(f"{kpi_id}: denominator column '{den_col}' not found")
            computed_kpis[kpi_id] = {"value": None, "flags": [f"denominator column '{den_col}' missing"]}
            continue

        numerator = df[num_col].sum()
        denominator = df[den_col].sum()

        if denominator == 0:
            flags.append(f"{kpi_id}: denominator sums to zero — check column '{den_col}'")
            computed_kpis[kpi_id] = {"value": None, "flags": ["denominator is zero"]}
            continue

        value = float(numerator) / float(denominator)
        kpi_flags: list[str] = []
        expected = kpi_def.get("expected_range") or {}
        if expected.get("min") is not None and value < expected["min"]:
            kpi_flags.append(f"value {value:.4f} below expected min {expected['min']}")
        if expected.get("max") is not None and value > expected["max"]:
            kpi_flags.append(f"value {value:.4f} above expected max {expected['max']}")

        computed_kpis[kpi_id] = {"value": round(value, 4), "flags": kpi_flags}
        flags.extend([f"{kpi_id}: {f}" for f in kpi_flags])

    latency_ms = int((time.time() - t0) * 1000)
    update_report(
        request_id,
        computed_kpis=computed_kpis,
        data_quality_flags=flags,
        status="computed",
    )
    log_agent_step(request_id, "standardise", {"kpi_list": kpi_list}, computed_kpis, latency_ms)

    return {
        "status": "standardise_complete",
        "computed_kpis": computed_kpis,
        "data_quality_flags": flags,
        "flag_count": len(flags),
    }
