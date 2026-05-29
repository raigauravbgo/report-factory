"""
KPI computation engine.
Loads staging data, evaluates KPI formulas, and returns chart-ready series.
"""
import re
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from core.database import engine


def _load_staging_df(table_name: str) -> pd.DataFrame:
    with engine.connect() as conn:
        return pd.read_sql_table(table_name, con=conn)


def _resample_rule(granularity: str) -> str:
    return {"daily": "D", "weekly": "W", "monthly": "ME"}.get(granularity.lower(), "ME")


_MEAN_RE = re.compile(r"^(?:mean|avg|average)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$", re.IGNORECASE)
_SUM_RE  = re.compile(r"^(?:sum|count)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$", re.IGNORECASE)


def _formula_agg(formula: str) -> str:
    """Return 'mean' or 'sum' based on the formula pattern."""
    if _MEAN_RE.match(formula.strip()):
        return "mean"
    if "/" in formula:
        return "ratio"
    return "sum"


def _eval_formula(df: pd.DataFrame, formula: str) -> pd.Series:
    """
    Evaluate a KPI formula against a DataFrame row-by-row.
    Handles: mean(col), avg(col), sum(col), col/col, plain col.
    """
    formula = formula.strip()

    # mean(col) / avg(col)
    m = _MEAN_RE.match(formula)
    if m:
        col = m.group(1)
        if col in df.columns:
            return df[col].apply(pd.to_numeric, errors="coerce")
        return pd.Series(dtype=float)

    # sum(col) / count(col)
    s = _SUM_RE.match(formula)
    if s:
        col = s.group(1)
        if col in df.columns:
            return df[col].apply(pd.to_numeric, errors="coerce")
        return pd.Series(dtype=float)

    # Ratio formula: numerator / denominator
    if "/" in formula:
        parts = [p.strip() for p in formula.split("/", 1)]
        num_cols = [c for c in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", parts[0]) if c in df.columns]
        den_cols = [c for c in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", parts[1]) if c in df.columns]
        if num_cols and den_cols:
            num = df[num_cols].apply(pd.to_numeric, errors="coerce").sum(axis=1)
            den = df[den_cols].apply(pd.to_numeric, errors="coerce").sum(axis=1)
            return num / den.replace(0, pd.NA)

    # Plain column name
    all_cols = re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", formula)
    valid = [c for c in all_cols if c in df.columns]
    if valid:
        return df[valid[0]].apply(pd.to_numeric, errors="coerce")

    return pd.Series(dtype=float)


def compute_dashboard(recipe_config: dict, staging_table_name: str) -> dict:
    """
    Given a recipe config and the staging table name, compute KPI time series.
    Returns chart-ready JSON: { kpi_summaries, time_series, breakdown }
    """
    df = _load_staging_df(staging_table_name)
    if df.empty:
        return {"kpi_summaries": [], "time_series": [], "breakdown": []}

    date_col = recipe_config.get("date_column")
    granularity = recipe_config.get("granularity", "monthly")
    kpis = recipe_config.get("kpis", [])
    dimensions = recipe_config.get("dimensions", [])

    # Parse date column
    if date_col and date_col in df.columns:
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df = df.dropna(subset=[date_col])
        df = df.set_index(date_col).sort_index()
    else:
        date_col = None

    rule = _resample_rule(granularity)
    kpi_summaries: list[dict] = []
    time_series: list[dict] = []
    breakdown: list[dict] = []

    for kpi in kpis:
        name = kpi.get("name", "")
        formula = kpi.get("formula", "")

        series = _eval_formula(df, formula)
        if series.empty:
            kpi_summaries.append({"name": name, "value": None, "formula": formula})
            continue

        agg = _formula_agg(formula)
        overall = float(series.mean()) if agg in ("mean", "ratio") else float(series.sum())
        kpi_summaries.append({
            "name": name,
            "value": round(overall, 4),
            "formula": formula,
        })

        # Time series (resampled)
        if date_col:
            resampled = (
                series.resample(rule).mean()
                if agg in ("mean", "ratio")
                else series.resample(rule).sum()
            ).dropna()

            time_series.append({
                "kpi": name,
                "data": [
                    {"date": str(ts.date()), "value": round(float(v), 4)}
                    for ts, v in resampled.items()
                    if pd.notna(v)
                ],
            })

        # Breakdown by first dimension
        if dimensions:
            dim = dimensions[0]
            if dim in df.columns:
                df_reset = df.reset_index() if date_col else df
                grouped = df_reset.groupby(dim).apply(
                    lambda g: _eval_formula(g, formula).mean()
                    if agg in ("mean", "ratio")
                    else _eval_formula(g, formula).sum(),
                    include_groups=False,
                ).dropna()

                breakdown.append({
                    "kpi": name,
                    "dimension": dim,
                    "data": [
                        {"label": str(k), "value": round(float(v), 4)}
                        for k, v in grouped.items()
                        if pd.notna(v)
                    ][:20],  # cap at 20 groups
                })

    insights = _generate_insights(kpi_summaries, time_series)

    return {
        "kpi_summaries": kpi_summaries,
        "time_series": time_series,
        "breakdown": breakdown,
        "insights": insights,
    }


def _generate_insights(kpi_summaries: list[dict], time_series: list[dict]) -> list[dict]:
    """Generate executive insights using Finding→Narrative→Decision framework."""
    insights = []

    for kpi in kpi_summaries:
        name = kpi["name"].replace("_", " ")
        value = kpi["value"]
        formula = kpi["formula"]
        if value is None:
            continue

        # Find matching time series
        ts = next((t for t in time_series if t["kpi"] == kpi["name"]), None)
        if not ts or len(ts["data"]) < 2:
            continue

        values = [p["value"] for p in ts["data"] if p["value"] is not None]
        if len(values) < 2:
            continue

        last = values[-1]
        prev = values[-2]
        first = values[0]

        if prev == 0:
            continue

        pct_change = (last - prev) / abs(prev) * 100
        overall_change = (last - first) / abs(first) * 100 if first != 0 else 0

        is_ratio = "/" in formula
        fmt = lambda v: f"{v * 100:.1f}%" if is_ratio else f"{v:,.1f}"

        if abs(pct_change) >= 15:
            severity = "high" if abs(pct_change) >= 25 else "medium"
            direction = "increased" if pct_change > 0 else "decreased"
            insights.append({
                "severity": severity,
                "headline": f"{name.title()} {direction} {abs(pct_change):.0f}% last period",
                "finding": (
                    f"{name.title()} moved from {fmt(prev)} to {fmt(last)} in the most recent period "
                    f"({'+' if pct_change > 0 else ''}{pct_change:.1f}%). "
                    f"Over the full window it has {'improved' if overall_change > 0 else 'declined'} "
                    f"by {abs(overall_change):.0f}%."
                ),
                "action": f"Review {name} drivers and compare against prior-period benchmarks.",
            })
        elif abs(overall_change) >= 10:
            insights.append({
                "severity": "low",
                "headline": f"{name.title()} shows a gradual trend",
                "finding": (
                    f"{name.title()} has {'improved' if overall_change > 0 else 'declined'} "
                    f"by {abs(overall_change):.0f}% from {fmt(first)} to {fmt(last)} over the period."
                ),
                "action": None,
            })

    return insights[:5]
