from __future__ import annotations

import pandas as pd

from app.kpi_registry.registry import KPIRegistry


def compute(
    silver_frames: dict[str, dict],
    available_kpi_ids: list[str],
    registry: KPIRegistry,
) -> dict:
    """Compute KPI results from silver-layer DataFrames."""
    results = {}
    for kpi_id in available_kpi_ids:
        kpi_def = registry.get(kpi_id)
        if not kpi_def:
            continue
        try:
            result = _apply_kpi(kpi_def, silver_frames)
            results[kpi_id] = {
                "kpi_id": kpi_id,
                "name": kpi_def["name"],
                "value": result.get("value"),
                "breakdown": result.get("breakdown"),
                "chart_type": kpi_def.get("chart_type", "bar"),
                "unit": kpi_def.get("unit", ""),
            }
        except Exception as exc:
            results[kpi_id] = {
                "kpi_id": kpi_id,
                "name": kpi_def["name"],
                "error": str(exc),
            }
    return results


def _apply_kpi(kpi_def: dict, frames: dict[str, dict]) -> dict:
    formula = kpi_def.get("formula", "")
    required_cols = kpi_def.get("required_columns", [])

    combined = _merge_frames(frames)
    if combined is None or combined.empty:
        return {"value": None, "breakdown": None}

    available_cols = set(combined.columns)
    if not set(required_cols).issubset(available_cols):
        return {"value": None, "breakdown": None}

    # ── Parameterised generic formulas ──────────────────────────────────────

    # sum(col)
    if formula.startswith("sum(") and formula.endswith(")") and "," not in formula:
        col = formula[4:-1].strip()
        if col in available_cols:
            return {"value": round(float(combined[col].sum()), 2), "breakdown": None}

    # avg(col)
    if formula.startswith("avg(") and formula.endswith(")") and "," not in formula:
        col = formula[4:-1].strip()
        if col in available_cols:
            return {"value": round(float(combined[col].mean()), 2), "breakdown": None}

    # count(*)
    if formula == "count(*)":
        return {"value": int(len(combined)), "breakdown": None}

    # rate(flag_col) — % of rows where flag = 1 / True (numeric flags)
    if formula.startswith("rate(") and formula.endswith(")"):
        col = formula[5:-1].strip()
        if col in available_cols:
            rate_val = combined[col].astype(float).mean() * 100
            return {"value": round(float(rate_val), 2), "breakdown": None}

    # rate_flag(flag_col) — handles Yes/No, True/False, 1/0 string flags
    if formula.startswith("rate_flag(") and formula.endswith(")"):
        col = formula[10:-1].strip()
        if col in available_cols:
            series = combined[col].astype(str).str.strip().str.lower()
            flagged = series.isin(["yes", "true", "1", "y", "returned", "flagged"])
            rate_val = flagged.mean() * 100
            return {"value": round(float(rate_val), 2), "breakdown": None}

    # avg_pct(col) — strips "%" suffix and averages (for columns like "10%")
    if formula.startswith("avg_pct(") and formula.endswith(")"):
        col = formula[8:-1].strip()
        if col in available_cols:
            numeric = (
                combined[col].astype(str)
                .str.replace("%", "", regex=False)
                .str.strip()
            )
            numeric = pd.to_numeric(numeric, errors="coerce")
            return {"value": round(float(numeric.mean()), 2), "breakdown": None}

    # count_by(field) — value counts of any categorical column
    if formula.startswith("count_by(") and formula.endswith(")"):
        field = formula[9:-1].strip()
        if field in available_cols:
            series = combined[field].value_counts()
            return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    # sum_by(field, col) — sum of col grouped by field
    if formula.startswith("sum_by(") and formula.endswith(")"):
        parts = [p.strip() for p in formula[7:-1].split(",")]
        if len(parts) == 2:
            field, col = parts
            if field in available_cols and col in available_cols:
                series = combined.groupby(field)[col].sum().sort_values(ascending=False)
                return {"value": round(float(combined[col].sum()), 2), "breakdown": _safe_dict(series)}

    # avg_by(field, col) — mean of col grouped by field
    if formula.startswith("avg_by(") and formula.endswith(")"):
        parts = [p.strip() for p in formula[7:-1].split(",")]
        if len(parts) == 2:
            field, col = parts
            if field in available_cols and col in available_cols:
                series = combined.groupby(field)[col].mean().round(2).sort_values(ascending=False)
                return {"value": round(float(combined[col].mean()), 2), "breakdown": _safe_dict(series)}

    # count_by_date — daily record count
    if formula == "count_by_date" and "date" in available_cols:
        series = combined.groupby(combined["date"].dt.date).size()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    # sum_by_date — daily sum of revenue_amount (legacy)
    if formula == "sum_by_date" and "date" in available_cols and "revenue_amount" in available_cols:
        series = combined.groupby(combined["date"].dt.date)["revenue_amount"].sum()
        return {"value": round(float(combined["revenue_amount"].sum()), 2), "breakdown": _safe_dict(series)}

    # sum_col_by_date(col) — daily sum of any numeric column
    if formula.startswith("sum_col_by_date(") and formula.endswith(")"):
        col = formula[16:-1].strip()
        if "date" in available_cols and col in available_cols:
            series = combined.groupby(combined["date"].dt.date)[col].sum()
            return {"value": round(float(combined[col].sum()), 2), "breakdown": _safe_dict(series)}

    # sum_by_client (legacy)
    if formula == "sum_by_client" and "client_id" in available_cols and "revenue_amount" in available_cols:
        series = combined.groupby("client_id")["revenue_amount"].sum()
        return {"value": round(float(combined["revenue_amount"].sum()), 2), "breakdown": _safe_dict(series)}

    # count_by_segment (legacy)
    if formula == "count_by_segment" and "segment" in available_cols:
        series = combined["segment"].value_counts()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    # min_max_date
    if formula == "min_max_date" and "date" in available_cols:
        dates = pd.to_datetime(combined["date"], errors="coerce").dropna()
        min_d = dates.min().strftime("%d %b %Y")
        max_d = dates.max().strftime("%d %b %Y")
        return {"value": f"{min_d} → {max_d}", "breakdown": None}

    # ── Named formulas — collections ────────────────────────────────────────

    if formula == "contactability_rate" and "disposition" in available_cols:
        total = len(combined)
        contacted = combined["disposition"].str.lower().isin(
            ["contact", "rpc", "contacted", "live_contact", "right party contact", "connected"]
        ).sum()
        rate = (contacted / total * 100) if total > 0 else 0
        return {"value": round(float(rate), 2), "breakdown": None}

    if formula == "rpc_rate" and "is_rpc" in available_cols:
        return {"value": round(float(combined["is_rpc"].astype(float).mean() * 100), 2), "breakdown": None}

    if formula == "ptp_conversion" and "is_rpc" in available_cols and "is_ptp" in available_cols:
        rpc_rows = combined[combined["is_rpc"].astype(bool)]
        rate = (rpc_rows["is_ptp"].astype(float).mean() * 100) if len(rpc_rows) > 0 else 0
        return {"value": round(float(rate), 2), "breakdown": None}

    if formula == "count_by_agent" and "agent_id" in available_cols:
        series = combined["agent_id"].value_counts()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    if formula == "contactability_by_hour" and "call_timestamp" in available_cols:
        combined = combined.copy()
        combined["_hour"] = pd.to_datetime(combined["call_timestamp"], errors="coerce").dt.hour
        series = combined.groupby("_hour").size()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    if formula == "performance_by_channel" and "direction" in available_cols:
        series = combined["direction"].value_counts()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    if formula == "count_by_campaign" and "campaign_name" in available_cols:
        series = combined["campaign_name"].value_counts()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    if formula == "performance_by_region" and "region" in available_cols:
        series = combined["region"].value_counts()
        return {"value": int(len(combined)), "breakdown": _safe_dict(series)}

    # ── Named formulas — revenue ─────────────────────────────────────────────

    if formula == "revenue_per_agent" and "revenue_amount" in available_cols and "agent_id" in available_cols:
        series = combined.groupby("agent_id")["revenue_amount"].sum()
        return {"value": round(float(series.mean()), 2), "breakdown": _safe_dict(series.sort_values(ascending=False))}

    if formula == "contribution_margin" and "revenue_amount" in available_cols and "variable_cost" in available_cols:
        margin = combined["revenue_amount"].sum() - combined["variable_cost"].sum()
        return {"value": round(float(margin), 2), "breakdown": None}

    if formula == "revenue_by_segment" and "revenue_amount" in available_cols and "segment" in available_cols:
        series = combined.groupby("segment")["revenue_amount"].sum()
        return {"value": round(float(combined["revenue_amount"].sum()), 2), "breakdown": _safe_dict(series)}

    # ── Named formulas — work avoidance ──────────────────────────────────────

    if formula == "avoidance_rate" and "avoidance_duration" in available_cols and "login_time" in available_cols:
        total_login = combined["login_time"].sum()
        rate = (combined["avoidance_duration"].sum() / total_login * 100) if total_login > 0 else 0
        return {"value": round(float(rate), 2), "breakdown": None}

    if formula == "not_ready_rate" and "not_ready_time" in available_cols and "login_time" in available_cols:
        total_login = combined["login_time"].sum()
        rate = (combined["not_ready_time"].sum() / total_login * 100) if total_login > 0 else 0
        return {"value": round(float(rate), 2), "breakdown": None}

    return {"value": None, "breakdown": None}


def _safe_dict(series: pd.Series) -> dict:
    """Convert a Series to a plain dict with JSON-safe keys."""
    return {str(k): v for k, v in series.items()}


def _merge_frames(frames: dict[str, dict]) -> pd.DataFrame | None:
    dfs = [info["dataframe"] for info in frames.values() if not info["dataframe"].empty]
    if not dfs:
        return None
    if len(dfs) == 1:
        return dfs[0]
    return pd.concat(dfs, ignore_index=True)
