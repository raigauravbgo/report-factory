"""Dashboard data endpoint — aggregates staging table data per recipe config."""
import logging
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from models.report_recipe import ReportRecipe
from schemas.interview import RecipeConfig

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
logger = logging.getLogger(__name__)

_GRANULARITY_FREQ = {"monthly": "M", "weekly": "W", "daily": "D", "yearly": "Y"}


def _eval_kpi(df: pd.DataFrame, formula: str) -> "pd.Series | None":
    """Evaluate a KPI formula against a DataFrame row-wise. Returns numeric Series or None."""
    import re as _re
    formula = formula.strip()

    if formula in df.columns:
        return pd.to_numeric(df[formula], errors="coerce")

    # Aggregate function wrapper: mean(col), sum(col), avg(col), etc.
    agg_match = _re.match(
        r'^(?:mean|avg|average|sum|count|median|max|min)\(([^)]+)\)$',
        formula,
        _re.IGNORECASE,
    )
    if agg_match:
        col = agg_match.group(1).strip()
        if col in df.columns:
            return pd.to_numeric(df[col], errors="coerce")

    # numerator / denominator
    if "/" in formula:
        parts = [p.strip() for p in formula.split("/", 1)]
        if len(parts) == 2:
            def _unwrap(s: str) -> str:
                m = _re.match(r'^(?:mean|avg|sum|count|median|max|min)\(([^)]+)\)$', s, _re.IGNORECASE)
                return m.group(1).strip() if m else s
            num, den = _unwrap(parts[0]), _unwrap(parts[1])
            if num in df.columns and den in df.columns:
                n = pd.to_numeric(df[num], errors="coerce")
                d = pd.to_numeric(df[den], errors="coerce")
                with pd.option_context("mode.use_inf_as_na", True):
                    return (n / d.replace(0, pd.NA)).astype(float)

    try:
        import numpy as np
        from asteval import Interpreter
        aeval = Interpreter()
        aeval.symtable["mean"] = np.mean
        aeval.symtable["sum"] = np.sum
        aeval.symtable["avg"] = np.mean
        aeval.symtable["median"] = np.median
        aeval.symtable["max"] = np.max
        aeval.symtable["min"] = np.min
        for col in df.columns:
            aeval.symtable[col] = pd.to_numeric(df[col], errors="coerce")
        result = aeval.eval(formula)
        if isinstance(result, pd.Series):
            return result.astype(float)
        if isinstance(result, (int, float)):
            return pd.Series([result] * len(df), dtype=float)
    except Exception:
        pass

    return None


def _determine_status(delta_pct: float) -> str:
    if delta_pct >= 2.0:
        return "good"
    if delta_pct >= -2.0:
        return "neutral"
    if delta_pct >= -5.0:
        return "warning"
    return "risk"


def _build_metrics(kpi_summaries: list, time_series: dict) -> list:
    """Enhance KPI summaries with period-over-period delta from time series."""
    metrics = []
    for kpi in kpi_summaries:
        name = kpi["name"]
        series = time_series.get(name, [])

        current_val = kpi["value"]
        prior_val: float | None = None
        delta: float | None = None
        delta_pct: float | None = None
        current_period: str | None = None
        status = "neutral"

        if len(series) >= 2:
            current_val = series[-1]["value"]
            prior_val = series[-2]["value"]
            current_period = series[-1]["period"]
            if prior_val and prior_val != 0:
                delta = current_val - prior_val
                delta_pct = (delta / abs(prior_val)) * 100
                status = _determine_status(delta_pct)
        elif len(series) == 1:
            current_period = series[0]["period"]

        metrics.append({
            "id": name.lower().replace(" ", "_"),
            "name": name,
            "formula": kpi["formula"],
            "value": round(current_val, 2),
            "prior_value": round(prior_val, 2) if prior_val is not None else None,
            "delta": round(delta, 2) if delta is not None else None,
            "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
            "delta_type": "absolute",
            "count": kpi["count"],
            "status": status,
            "direction": "higher_is_better",
            "period": current_period,
        })
    return metrics


def _generate_insights(metrics: list, dimension_breakdowns: dict) -> list:
    """Generate top-performer benchmark insights per KPI."""
    insights = []

    for m in metrics:
        kpi_name = m["name"]
        value = m["value"]
        count = m["count"]
        period = m["period"] or ""

        # Find first dimension that has ≥2 segments for this KPI
        breakdown_items: list | None = None
        breakdown_dim: str | None = None
        for dim_name, kpis_by_dim in dimension_breakdowns.items():
            items = kpis_by_dim.get(kpi_name, [])
            if len(items) >= 2:
                breakdown_items = items
                breakdown_dim = dim_name
                break

        if breakdown_items:
            sorted_items = sorted(breakdown_items, key=lambda x: x["value"], reverse=True)
            top = sorted_items[0]
            bottom = sorted_items[-1]
            n = len(sorted_items)
            mean_val = sum(x["value"] for x in sorted_items) / n
            gap = top["value"] - bottom["value"]
            gap_from_mean = top["value"] - mean_val

            spread_pct = (gap / mean_val * 100) if mean_val else 0
            if spread_pct < 5:
                severity = "low"
            elif spread_pct <= 15:
                severity = "medium"
            else:
                severity = "high"

            insights.append({
                "severity": severity,
                "headline": f"{top['name']} leads {kpi_name} at {top['value']:.1f}",
                "finding": (
                    f"'{top['name']}' is {gap_from_mean:.1f} pts above the "
                    f"{n}-segment average of {mean_val:.1f}."
                ),
                "evidence": (
                    f"Range: {bottom['value']:.1f} ('{bottom['name']}') → "
                    f"{top['value']:.1f} ('{top['name']}'). "
                    f"Gap: {gap:.1f} pts across {n} {breakdown_dim} segments."
                ),
                "driver": f"'{top['name']}' is the benchmark for {kpi_name}.",
                "impact": f"A {gap:.1f}-pt spread across {n} segments indicates a coaching opportunity.",
                "decision": f"Investigate what practices drive higher {kpi_name} at '{top['name']}'.",
                "action": f"Use '{top['name']}' as the coaching benchmark for underperforming segments.",
            })
        else:
            period_label = f" ({period})" if period else ""
            insights.append({
                "severity": "low",
                "headline": f"{kpi_name}: {value:.1f}",
                "finding": f"Current {kpi_name} is {value:.1f} across {count:,} records{period_label}.",
                "evidence": "No segment breakdown available for this metric.",
                "driver": "Add a dimension filter to surface segment-level drivers.",
                "impact": "Cannot assess spread or coaching opportunity without segment data.",
                "decision": "Select a dimension column to enable segment analysis.",
                "action": "Use the filter bar to slice by team, pod, or agent.",
            })

    return insights


def _assess_data_quality(df: pd.DataFrame, date_col: str) -> dict:
    warnings: list[str] = []
    status = "ok"
    most_recent_date = None
    date_coverage = None

    if date_col and "__date__" in df.columns:
        valid = df["__date__"].dropna()
        if len(valid):
            most_recent = valid.max()
            oldest = valid.min()
            most_recent_date = str(most_recent.date())
            date_coverage = f"{oldest.strftime('%Y-%m')} – {most_recent.strftime('%Y-%m')}"
            days_since = (pd.Timestamp.now() - most_recent).days
            if days_since > 45:
                warnings.append(f"Most recent data is {days_since} days old ({most_recent_date}).")
                status = "warning"

        null_pct = df[date_col].isna().mean() * 100 if date_col in df.columns else 0
        if null_pct > 5:
            warnings.append(f"{null_pct:.1f}% of rows have missing dates and were excluded.")
            if status == "ok":
                status = "warning"

    return {
        "status": status,
        "row_count": len(df),
        "most_recent_date": most_recent_date,
        "date_coverage": date_coverage,
        "warnings": warnings,
    }


def _load_joined_df(config: RecipeConfig, db: Session, engine) -> pd.DataFrame:
    """Load the fact staging table and LEFT JOIN dimension tables via confirmed FK relationships."""
    from sqlalchemy import inspect as sa_inspect
    from models.data_model import DataModel

    fact_uid = config.upload_id
    all_uids: list[int] = list(config.upload_ids) if config.upload_ids else [fact_uid]

    # Load all available staging tables
    inspect = sa_inspect(engine)
    frames: dict[int, pd.DataFrame] = {}
    for uid in all_uids:
        tname = f"staging_{uid}"
        if inspect.has_table(tname):
            with engine.connect() as conn:
                frames[uid] = pd.read_sql_table(tname, conn)

    if fact_uid not in frames:
        # Fall back to the first available table
        if not frames:
            return pd.DataFrame()
        fact_uid = next(iter(frames))

    result = frames[fact_uid].copy()

    # No other tables → nothing to join
    if len(frames) < 2:
        return result

    # Fetch FK relationships from the data model
    dm = db.query(DataModel).filter(DataModel.dataset_id == config.dataset_id).first()
    if not dm or not dm.foreign_keys:
        return result

    joined_uids: set[int] = {fact_uid}
    for fk in dm.foreign_keys:
        if not fk.get("confirmed", True):
            continue

        from_uid: int = fk["from_upload_id"]
        to_uid: int = fk["to_upload_id"]
        from_col: str = fk["from_col"]
        to_col: str = fk["to_col"]

        # Only join dimension tables that haven't been joined yet
        _MAX_JOIN_ROWS = 500_000
        if from_uid == fact_uid and to_uid in frames and to_uid not in joined_uids:
            dim_df = frames[to_uid]
            # Drop columns already present in result (except the join key)
            drop_cols = [c for c in dim_df.columns if c in result.columns and c != to_col]
            merged = result.merge(
                dim_df.drop(columns=drop_cols),
                left_on=from_col,
                right_on=to_col,
                how="left",
                suffixes=("", f"_{to_uid}"),
            )
            if len(merged) > _MAX_JOIN_ROWS:
                logger.warning(
                    "FK join produced %d rows (limit %d) for upload %d — skipping join.",
                    len(merged), _MAX_JOIN_ROWS, to_uid,
                )
            else:
                result = merged
            joined_uids.add(to_uid)
        elif to_uid == fact_uid and from_uid in frames and from_uid not in joined_uids:
            dim_df = frames[from_uid]
            drop_cols = [c for c in dim_df.columns if c in result.columns and c != from_col]
            merged = result.merge(
                dim_df.drop(columns=drop_cols),
                left_on=to_col,
                right_on=from_col,
                how="left",
                suffixes=("", f"_{from_uid}"),
            )
            if len(merged) > _MAX_JOIN_ROWS:
                logger.warning(
                    "FK join produced %d rows (limit %d) for upload %d — skipping join.",
                    len(merged), _MAX_JOIN_ROWS, from_uid,
                )
            else:
                result = merged
            joined_uids.add(from_uid)

    return result


@router.get("/{recipe_id}/data", response_model=dict)
def get_dashboard_data(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return aggregated chart data for a recipe.

    Accepts optional filter query params prefixed with ``f_``:
      GET /dashboard/3/data?f_department=US+CARE&f_location=Philippines
    """
    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")

    config = RecipeConfig(**recipe.config)
    generated_at = datetime.now(timezone.utc).isoformat()

    # Parse active filters from query params (prefix "f_")
    active_filters: dict[str, str] = {
        k[2:]: v
        for k, v in request.query_params.items()
        if k.startswith("f_") and v
    }

    try:
        from sqlalchemy import inspect as sa_inspect
        engine = db.get_bind()
        fact_table = f"staging_{config.upload_id}"
        if not sa_inspect(engine).has_table(fact_table):
            raise HTTPException(422, f"Staging table for upload {config.upload_id} not found. Re-upload the file.")
        df = _load_joined_df(config, db, engine)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Could not load data: {exc}") from exc

    empty_envelope = {
        "recipe_id": recipe_id,
        "generated_at": generated_at,
        "row_count": 0,
        "approved": bool(recipe.approved_at),
        "active_filters": active_filters,
        "filter_options": {},
        "metrics": [],
        "kpi_summaries": [],
        "time_series": {},
        "dimension_breakdowns": {},
        "insights": [],
        "data_quality": {"status": "ok", "row_count": 0, "most_recent_date": None, "date_coverage": None, "warnings": ["No data rows found."]},
    }
    if df.empty:
        return empty_envelope

    # Build filter_options BEFORE applying active filters so dropdowns always show all values
    filter_cols = [c for c in (config.filters or []) if c in df.columns]
    filter_options: dict[str, list[str]] = {
        col: sorted(df[col].dropna().astype(str).unique().tolist())[:100]
        for col in filter_cols
    }

    # Apply active filters to the DataFrame
    for col, val in active_filters.items():
        if col in df.columns:
            df = df[df[col].astype(str) == val]

    if df.empty:
        empty_envelope["filter_options"] = filter_options
        empty_envelope["active_filters"] = active_filters
        return empty_envelope

    # Parse date column
    date_col = config.date_column or ""
    has_dates = False
    if date_col and date_col in df.columns:
        df["__date__"] = pd.to_datetime(df[date_col], errors="coerce")
        df["__date__"] = df["__date__"].clip(
            lower=pd.Timestamp("1900-01-01"), upper=pd.Timestamp("2100-12-31")
        )
        freq = _GRANULARITY_FREQ.get(config.granularity or "monthly", "M")
        df["__period__"] = df["__date__"].dt.to_period(freq).astype(str)
        has_dates = bool(df["__date__"].notna().any())

    # KPI summaries
    kpi_summaries = []
    for kpi in config.kpis:
        series = _eval_kpi(df, kpi.formula)
        if series is not None and series.notna().any():
            kpi_summaries.append({
                "name": kpi.name,
                "formula": kpi.formula,
                "value": round(float(series.mean()), 2),
                "count": int(series.notna().sum()),
            })

    # Time-series
    time_series: dict = {}
    if has_dates:
        for kpi in config.kpis:
            series = _eval_kpi(df, kpi.formula)
            if series is None or not series.notna().any():
                continue
            df["__val__"] = series
            grouped = (
                df.groupby("__period__")["__val__"]
                .mean()
                .reset_index()
                .sort_values("__period__")
            )
            time_series[kpi.name] = [
                {"period": str(row["__period__"]), "value": round(float(row["__val__"]) if pd.notna(row["__val__"]) else 0.0, 2)}
                for _, row in grouped.iterrows()
            ]
            df.drop(columns=["__val__"], inplace=True, errors="ignore")

    # Dimension breakdowns
    dimension_breakdowns: dict = {}
    for dim in (config.dimensions or [])[:3]:
        if dim not in df.columns:
            continue
        dimension_breakdowns[dim] = {}
        for kpi in config.kpis[:2]:
            series = _eval_kpi(df, kpi.formula)
            if series is None or not series.notna().any():
                continue
            df["__val__"] = series
            grouped = (
                df.groupby(dim)["__val__"]
                .mean()
                .reset_index()
                .sort_values("__val__", ascending=False)
                .head(20)
            )
            dimension_breakdowns[dim][kpi.name] = [
                {"name": str(row[dim]), "value": round(float(row["__val__"]) if pd.notna(row["__val__"]) else 0.0, 2)}
                for _, row in grouped.iterrows()
            ]
            df.drop(columns=["__val__"], inplace=True, errors="ignore")

    metrics = _build_metrics(kpi_summaries, time_series)
    insights = _generate_insights(metrics, dimension_breakdowns)
    data_quality = _assess_data_quality(df, date_col)

    return {
        "recipe_id": recipe_id,
        "generated_at": generated_at,
        "row_count": len(df),
        "approved": bool(recipe.approved_at),
        "filters": {"date_column": config.date_column, "granularity": config.granularity, "dimensions": config.dimensions},
        "filter_options": filter_options,
        "active_filters": active_filters,
        "metrics": metrics,
        "kpi_summaries": kpi_summaries,
        "time_series": time_series,
        "dimension_breakdowns": dimension_breakdowns,
        "insights": insights,
        "data_quality": data_quality,
    }
