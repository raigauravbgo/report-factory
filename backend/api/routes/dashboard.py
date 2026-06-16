"""Dashboard data endpoint — aggregates staging table data per recipe config."""
import logging
import re
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
                result = n / d.replace(0, float("nan"))
                result = result.replace([float("inf"), float("-inf")], float("nan"))
                return result.astype(float)

            # Compound denominator: sum(A) / (sum(B) + sum(C))
            # Also handles missing-parens form: sum(A) / sum(B) + sum(C)
            # Strips outer parens from denominator then splits on + to get addend columns.
            den_inner = parts[1]
            if den_inner.startswith("(") and den_inner.endswith(")"):
                den_inner = den_inner[1:-1].strip()
            addend_terms = [t.strip() for t in _re.split(r"\s*\+\s*", den_inner)]
            den_cols = [_unwrap(t) for t in addend_terms]
            num_col = _unwrap(parts[0])
            if (num_col in df.columns and len(den_cols) >= 2
                    and all(c in df.columns for c in den_cols)):
                n = pd.to_numeric(df[num_col], errors="coerce")
                d = sum(pd.to_numeric(df[c], errors="coerce") for c in den_cols)
                result = n / d.replace(0, float("nan"))
                result = result.replace([float("inf"), float("-inf")], float("nan"))
                return result.astype(float)

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


def _formula_needs_col(formula: str) -> "str | None":
    """Return the primary column a formula references (used for fallback df lookup)."""
    import re as _re
    f = formula.strip()
    m = _re.match(r'^(?:mean|avg|average|sum|count|median|max|min)\(([^)]+)\)$', f, _re.I)
    if m:
        return m.group(1).strip()
    if '/' in f:
        for part in f.split('/', 1):
            m2 = _re.match(r'^(?:mean|avg|sum|count|median|max|min)\(([^)]+)\)$', part.strip(), _re.I)
            if m2:
                return m2.group(1).strip()
    if _re.match(r'^[a-zA-Z_]\w*$', f):
        return f
    return None


def _safe_to_merge(
    fact_df: "pd.DataFrame",
    fact_col: str,
    dim_df: "pd.DataFrame",
    dim_col: str,
    max_rows: int,
    dim_uid: int,
    stored_max_dup: "int | None" = None,
) -> bool:
    """Return True only if the LEFT JOIN is estimated to produce ≤ max_rows rows.

    E5: uses stored_max_dup from the FK dict when available (avoids recomputing
    value_counts on every dashboard load). Falls back to live computation for
    legacy FK records that predate the join_type field.
    """
    if fact_col not in fact_df.columns or dim_col not in dim_df.columns:
        return True  # columns missing — merge will produce 0 matches, no explosion
    if stored_max_dup is not None:
        max_dim_per_key = stored_max_dup
    else:
        dim_counts = dim_df[dim_col].value_counts()
        max_dim_per_key = int(dim_counts.max()) if len(dim_counts) else 1
    if max_dim_per_key <= 1:
        return True  # clean 1:1 or 1:many dim — safe
    estimated = len(fact_df) * max_dim_per_key
    if estimated > max_rows:
        logger.warning(
            "Pre-merge estimate: ~%d rows (dim upload %d has up to %d copies of a single key) "
            "exceeds limit %d — skipping FK join.",
            estimated, dim_uid, max_dim_per_key, max_rows,
        )
        return False
    return True


def _pre_aggregate_dim(dim_df: "pd.DataFrame", key_col: str, drop_cols: list) -> "pd.DataFrame":
    """Deduplicate a many-to-many dimension table to one row per key.

    A2: used when join_type == 'many_to_many' to prevent row duplication while
    still enriching the fact with dimension attributes (department, location, etc.).
    Takes the first occurrence per key — sufficient for categorical enrichment.
    """
    cols_to_keep = [c for c in dim_df.columns if c not in drop_cols]
    return (
        dim_df[cols_to_keep]
        .drop_duplicates(subset=[key_col], keep="first")
        .reset_index(drop=True)
    )


def _load_joined_df(config: RecipeConfig, db: Session, engine, fact_uid_override: int | None = None) -> pd.DataFrame:
    """Load a fact staging table and LEFT JOIN dimension tables via confirmed FK relationships.

    ``fact_uid_override`` lets callers load a secondary fact table (e.g. for a KPI whose
    source is a different file than the primary fact) while still applying all FK joins.
    """
    from sqlalchemy import inspect as sa_inspect
    from models.data_model import DataModel

    fact_uid = fact_uid_override if fact_uid_override is not None else config.upload_id
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

    # Determine which uploads are dimensions vs facts — only join dims to the fact table
    dim_uids: set[int] = set()
    if dm.tables:
        for t in dm.tables:
            role = t.get("confirmed_role") or t.get("role")
            if role == "dimension":
                dim_uids.add(t["upload_id"])

    joined_uids: set[int] = {fact_uid}
    _MAX_JOIN_ROWS = 500_000
    for fk in dm.foreign_keys:
        if not fk.get("confirmed", True):
            continue

        from_uid: int = fk["from_upload_id"]
        to_uid: int = fk["to_upload_id"]
        from_col: str = fk["from_col"]
        to_col: str = fk["to_col"]
        # A1/E5: use stored join_type and dim_max_dup when present (avoids recomputing)
        join_type: str = fk.get("join_type", "unverified")
        stored_max_dup: "int | None" = fk.get("dim_max_dup")

        # Only join DIMENSION tables to the fact table — skip fact-to-fact FKs.
        # IMPORTANT: only add to joined_uids when the merge actually succeeds so that a
        # safe FK (e.g. agent_email→email) can still fire after an unsafe one
        # (e.g. department→department) was blocked by _safe_to_merge.
        if from_uid == fact_uid and to_uid in dim_uids and to_uid in frames and to_uid not in joined_uids:
            dim_df = frames[to_uid]
            drop_cols = [c for c in dim_df.columns if c in result.columns and c != to_col]
            if join_type == "many_to_many":
                # A2: pre-aggregate dim to avoid row duplication — take first value per key
                agg_dim = _pre_aggregate_dim(dim_df, to_col, drop_cols)
                result = result.merge(
                    agg_dim,
                    left_on=from_col,
                    right_on=to_col,
                    how="left",
                    suffixes=("", f"_{to_uid}"),
                )
                joined_uids.add(to_uid)
            elif _safe_to_merge(result, from_col, dim_df, to_col, _MAX_JOIN_ROWS, to_uid, stored_max_dup):
                result = result.merge(
                    dim_df.drop(columns=drop_cols),
                    left_on=from_col,
                    right_on=to_col,
                    how="left",
                    suffixes=("", f"_{to_uid}"),
                )
                joined_uids.add(to_uid)
        elif to_uid == fact_uid and from_uid in dim_uids and from_uid in frames and from_uid not in joined_uids:
            dim_df = frames[from_uid]
            drop_cols = [c for c in dim_df.columns if c in result.columns and c != from_col]
            if join_type == "many_to_many":
                # A2: pre-aggregate dim to avoid row duplication
                agg_dim = _pre_aggregate_dim(dim_df, from_col, drop_cols)
                result = result.merge(
                    agg_dim,
                    left_on=to_col,
                    right_on=from_col,
                    how="left",
                    suffixes=("", f"_{from_uid}"),
                )
                joined_uids.add(from_uid)
            elif _safe_to_merge(result, to_col, dim_df, from_col, _MAX_JOIN_ROWS, from_uid, stored_max_dup):
                result = result.merge(
                    dim_df.drop(columns=drop_cols),
                    left_on=to_col,
                    right_on=from_col,
                    how="left",
                    suffixes=("", f"_{from_uid}"),
                )
                joined_uids.add(from_uid)

    # RC3: Inherited dimension joins for secondary fact tables.
    # When fact_uid_override is set (secondary fact load), FKs in the data model may only
    # record primary_fact → dimension, not secondary_fact → dimension. If the secondary fact
    # shares the same join-key column name, we can still attach the dimension.
    if fact_uid_override is not None:
        unjoined_dims = dim_uids - joined_uids
        for fk in (dm.foreign_keys if dm else []):
            if not unjoined_dims:
                break
            if not fk.get("confirmed", True):
                continue
            f_from_uid: int = fk["from_upload_id"]
            f_to_uid: int = fk["to_upload_id"]
            f_from_col: str = fk["from_col"]
            f_to_col: str = fk["to_col"]
            fk_join_type: str = fk.get("join_type", "unverified")
            fk_stored_dup: "int | None" = fk.get("dim_max_dup")

            # FK points to an unjoined dim and the fact-side key exists in our result
            if f_to_uid in unjoined_dims and f_to_uid in frames and f_from_col in result.columns:
                dim_df = frames[f_to_uid]
                drop_cols = [c for c in dim_df.columns if c in result.columns and c != f_to_col]
                if fk_join_type == "many_to_many":
                    agg_dim = _pre_aggregate_dim(dim_df, f_to_col, drop_cols)
                    result = result.merge(agg_dim, left_on=f_from_col, right_on=f_to_col, how="left", suffixes=("", f"_{f_to_uid}"))
                    joined_uids.add(f_to_uid)
                    unjoined_dims.discard(f_to_uid)
                elif _safe_to_merge(result, f_from_col, dim_df, f_to_col, _MAX_JOIN_ROWS, f_to_uid, fk_stored_dup):
                    result = result.merge(dim_df.drop(columns=drop_cols), left_on=f_from_col, right_on=f_to_col, how="left", suffixes=("", f"_{f_to_uid}"))
                    joined_uids.add(f_to_uid)
                    unjoined_dims.discard(f_to_uid)

            # Reverse: FK from dim to some table, and the dim-side key exists in our result
            elif f_from_uid in unjoined_dims and f_from_uid in frames and f_to_col in result.columns:
                dim_df = frames[f_from_uid]
                drop_cols = [c for c in dim_df.columns if c in result.columns and c != f_from_col]
                if fk_join_type == "many_to_many":
                    agg_dim = _pre_aggregate_dim(dim_df, f_from_col, drop_cols)
                    result = result.merge(agg_dim, left_on=f_to_col, right_on=f_from_col, how="left", suffixes=("", f"_{f_from_uid}"))
                    joined_uids.add(f_from_uid)
                    unjoined_dims.discard(f_from_uid)
                elif _safe_to_merge(result, f_to_col, dim_df, f_from_col, _MAX_JOIN_ROWS, f_from_uid, fk_stored_dup):
                    result = result.merge(dim_df.drop(columns=drop_cols), left_on=f_to_col, right_on=f_from_col, how="left", suffixes=("", f"_{f_from_uid}"))
                    joined_uids.add(f_from_uid)
                    unjoined_dims.discard(f_from_uid)

    return result


def _load_fact_with_dim(
    fact_uid: int,
    config: "RecipeConfig",
    db: "Session",
    engine,
    active_filters: dict,
) -> "pd.DataFrame":
    """Load one fact staging table, LEFT JOIN the dimension/roster table onto it,
    then apply date parsing and active filters.

    Dimension columns (department, location, pod, etc.) always come from the
    roster — same-named columns in the fact table are dropped before joining so
    the roster is the single authoritative source for all dimension values.
    Returns an empty DataFrame if the staging table is missing or unreadable.
    """
    from sqlalchemy import inspect as sa_inspect
    from models.data_model import DataModel
    from models.column_schema import ColumnSchema

    inspect = sa_inspect(engine)
    fact_table = f"staging_{fact_uid}"
    if not inspect.has_table(fact_table):
        logger.warning("_load_fact_with_dim: staging table %s not found.", fact_table)
        return pd.DataFrame()

    try:
        with engine.connect() as conn:
            fact_df = pd.read_sql_table(fact_table, conn)
    except Exception as exc:
        logger.warning("_load_fact_with_dim: could not load %s: %s", fact_table, exc)
        return pd.DataFrame()

    if fact_df.empty:
        return fact_df

    # Locate the dimension table and FK for this fact upload
    dm = db.query(DataModel).filter(DataModel.dataset_id == config.dataset_id).first()
    dim_uids: set[int] = set()
    if dm and dm.tables:
        for t in dm.tables:
            role = t.get("confirmed_role") or t.get("role")
            if role == "dimension":
                dim_uids.add(t["upload_id"])

    dim_uid: "int | None" = None
    fact_join_col: "str | None" = None
    dim_join_col: "str | None" = None
    _fk_join_type: str = "unverified"
    _fk_max_dup: "int | None" = None
    if dm and dm.foreign_keys:
        for fk in dm.foreign_keys:
            if not fk.get("confirmed", True):
                continue
            fu, tu = fk["from_upload_id"], fk["to_upload_id"]
            if fu == fact_uid and tu in dim_uids:
                dim_uid, fact_join_col, dim_join_col = tu, fk["from_col"], fk["to_col"]
                _fk_join_type = fk.get("join_type", "unverified")
                _fk_max_dup = fk.get("dim_max_dup")
                break
            elif tu == fact_uid and fu in dim_uids:
                dim_uid, fact_join_col, dim_join_col = fu, fk["to_col"], fk["from_col"]
                _fk_join_type = fk.get("join_type", "unverified")
                _fk_max_dup = fk.get("dim_max_dup")
                break

    _MAX_JOIN_ROWS = 500_000

    # LEFT JOIN with dimension table — roster is authoritative for dimension columns.
    # Carry over the same safety guards from _load_joined_df that commit f3baa15
    # accidentally dropped: pre-aggregate many-to-many dims, and deduplicate any dim
    # that would otherwise cause a row-count explosion beyond _MAX_JOIN_ROWS.
    if dim_uid is not None and fact_join_col and dim_join_col:
        dim_table = f"staging_{dim_uid}"
        if inspect.has_table(dim_table):
            try:
                with engine.connect() as conn:
                    dim_df = pd.read_sql_table(dim_table, conn)
                # Drop same-named columns from the fact so the roster value wins
                dim_only_cols = [c for c in dim_df.columns if c != dim_join_col]
                fact_df = fact_df.drop(
                    columns=[c for c in dim_only_cols if c in fact_df.columns],
                    errors="ignore",
                )
                if _fk_join_type == "many_to_many":
                    # Pre-aggregate: one row per key prevents cartesian explosion
                    dim_df = _pre_aggregate_dim(dim_df, dim_join_col, [])
                elif not _safe_to_merge(
                    fact_df, fact_join_col, dim_df, dim_join_col,
                    _MAX_JOIN_ROWS, dim_uid, _fk_max_dup,
                ):
                    # Estimated post-join row count exceeds cap — deduplicate the dim
                    # on the join key so dimension enrichment is preserved without OOM.
                    logger.warning(
                        "_load_fact_with_dim: join %s→%s would exceed %d rows "
                        "(dim %d has duplicate keys); deduplicating on '%s'.",
                        fact_table, dim_table, _MAX_JOIN_ROWS, dim_uid, dim_join_col,
                    )
                    dim_df = dim_df.drop_duplicates(subset=[dim_join_col], keep="first")
                fact_df = fact_df.merge(
                    dim_df,
                    left_on=fact_join_col,
                    right_on=dim_join_col,
                    how="left",
                )
            except Exception as exc:
                logger.warning(
                    "_load_fact_with_dim: could not join dim %s onto fact %d: %s",
                    dim_table, fact_uid, exc,
                )

    # Date parsing: config.date_column → ColumnSchema role lookup → keyword heuristic
    date_col = config.date_column or ""
    resolved_date_col: "str | None" = date_col if (date_col and date_col in fact_df.columns) else None

    if not resolved_date_col:
        schema_date = (
            db.query(ColumnSchema.column_name)
            .filter(ColumnSchema.upload_id == fact_uid)
            .filter(
                (ColumnSchema.confirmed_role == "date")
                | ((ColumnSchema.confirmed_role.is_(None)) & (ColumnSchema.ai_role == "date"))
            )
            .first()
        )
        if not schema_date:
            schema_date = (
                db.query(ColumnSchema.column_name)
                .filter(ColumnSchema.upload_id == fact_uid)
                .filter(
                    (ColumnSchema.confirmed_type == "date")
                    | ((ColumnSchema.confirmed_type.is_(None)) & (ColumnSchema.ai_detected_type == "date"))
                )
                .first()
            )
        if schema_date:
            resolved_date_col = schema_date[0]

    if not resolved_date_col:
        _DATE_KW = re.compile(r"\b(date|time|period|month|week|day)\b", re.I)
        for col in fact_df.columns:
            if _DATE_KW.search(col):
                _parsed = pd.to_datetime(fact_df[col], errors="coerce")
                if _parsed.notna().mean() > 0.5 and (_parsed > pd.Timestamp("1971-01-01")).any():
                    resolved_date_col = col
                    break

    if resolved_date_col and resolved_date_col in fact_df.columns:
        fact_df["__date__"] = pd.to_datetime(fact_df[resolved_date_col], errors="coerce")
        fact_df["__date__"] = fact_df["__date__"].clip(
            lower=pd.Timestamp("1900-01-01"), upper=pd.Timestamp("2100-12-31")
        )
        if not fact_df["__date__"].isna().all():
            freq = _GRANULARITY_FREQ.get(config.granularity or "weekly", "W")
            fact_df["__period__"] = fact_df["__date__"].dt.to_period(freq).astype(str)

    # Apply active filters (dimension values come from roster so filters are consistent)
    for col, val in active_filters.items():
        if col in fact_df.columns:
            fact_df = fact_df[fact_df[col].astype(str) == val]

    return fact_df


@router.get("/{recipe_id}/data", response_model=dict)
def get_dashboard_data(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Return aggregated chart data for a recipe.

    Accepts optional filter query params prefixed with ``f_``:
      GET /dashboard/3/data?f_department=US+CARE&f_location=Philippines

    Each fact table is individually joined with the dimension/roster table so
    that dimension columns (department, location, pod) are consistent across
    all KPIs and come exclusively from the roster.
    """
    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")

    config = RecipeConfig(**recipe.config)
    generated_at = datetime.now(timezone.utc).isoformat()

    active_filters: dict[str, str] = {
        k[2:]: v
        for k, v in request.query_params.items()
        if k.startswith("f_") and v
    }

    try:
        from sqlalchemy import inspect as sa_inspect
        from models.column_schema import ColumnSchema
        from models.data_model import DataModel

        engine = db.get_bind()
        inspect = sa_inspect(engine)

        # Identify dimension upload_ids from DataModel so we don't treat them as fact sources
        dm = db.query(DataModel).filter(DataModel.dataset_id == config.dataset_id).first()
        dim_uids: set[int] = set()
        if dm and dm.tables:
            for t in dm.tables:
                role = t.get("confirmed_role") or t.get("role")
                if role == "dimension":
                    dim_uids.add(t["upload_id"])

        all_upload_ids: list[int] = list(config.upload_ids) if config.upload_ids else [config.upload_id]
        fact_upload_ids_in_config: list[int] = [u for u in all_upload_ids if u not in dim_uids]

        # Resolve upload_id for any KPI that doesn't have one (backward-compat for old recipes).
        # Uses ColumnSchema to find which fact staging table contains the formula's primary column.
        kpi_upload_map: dict[str, int] = {}
        for kpi in config.kpis:
            if kpi.upload_id is not None and kpi.upload_id not in dim_uids:
                kpi_upload_map[kpi.name] = kpi.upload_id
            else:
                needed = _formula_needs_col(kpi.formula)
                resolved_uid = config.upload_id  # default: primary fact
                if needed:
                    match = (
                        db.query(ColumnSchema.upload_id)
                        .filter(
                            ColumnSchema.column_name == needed,
                            ColumnSchema.upload_id.in_(fact_upload_ids_in_config),
                        )
                        .first()
                    )
                    if match:
                        resolved_uid = match[0]
                kpi_upload_map[kpi.name] = resolved_uid
                if kpi.upload_id is None:
                    logger.info(
                        "KPI '%s' had no upload_id — resolved to upload %d via column '%s'.",
                        kpi.name, resolved_uid, needed or "unknown",
                    )

        # Unique fact upload_ids needed, preserving order
        seen_uids: set[int] = set()
        fact_uids_needed: list[int] = []
        for uid in kpi_upload_map.values():
            if uid not in seen_uids:
                seen_uids.add(uid)
                fact_uids_needed.append(uid)

        if not fact_uids_needed or not any(inspect.has_table(f"staging_{u}") for u in fact_uids_needed):
            raise HTTPException(
                422,
                f"No staging tables found for recipe {recipe_id}. Re-upload the files.",
            )

        # Load each fact joined with roster; active filters applied inside
        fact_dfs: dict[int, pd.DataFrame] = {}
        for uid in fact_uids_needed:
            fact_dfs[uid] = _load_fact_with_dim(uid, config, db, engine, active_filters)

        # Build filter_options from the dimension/roster table (unfiltered — always show all values).
        # Since all dimension values now come from the roster, it is the authoritative source.
        filter_cols = [c for c in (config.filters or []) if c]
        filter_options: dict[str, list[str]] = {}
        dim_uid_for_opts = next(iter(dim_uids), None)
        if dim_uid_for_opts and inspect.has_table(f"staging_{dim_uid_for_opts}"):
            try:
                with engine.connect() as conn:
                    dim_opts_df = pd.read_sql_table(f"staging_{dim_uid_for_opts}", conn)
                for col in filter_cols:
                    if col in dim_opts_df.columns:
                        filter_options[col] = sorted(
                            dim_opts_df[col].dropna().astype(str).unique().tolist()
                        )[:100]
                # Expose dimension columns in filter dropdowns too
                for col in (config.dimensions or []):
                    if col not in filter_options and col in dim_opts_df.columns:
                        filter_options[col] = sorted(
                            dim_opts_df[col].dropna().astype(str).unique().tolist()
                        )[:100]
            except Exception as exc:
                logger.warning("Could not build filter_options from dim table: %s", exc)
        # Fallback: derive from primary fact df when dim table is unavailable
        if not filter_options:
            primary_df_for_opts = fact_dfs.get(config.upload_id) or next(
                (d for d in fact_dfs.values() if not d.empty), pd.DataFrame()
            )
            for col in filter_cols:
                if col in primary_df_for_opts.columns:
                    filter_options[col] = sorted(
                        primary_df_for_opts[col].dropna().astype(str).unique().tolist()
                    )[:100]

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Could not load data: {exc}") from exc

    # Primary fact df — used for row_count and data_quality reporting
    _prim = fact_dfs.get(config.upload_id)
    primary_df = (
        _prim if (_prim is not None and not _prim.empty)
        else next((d for d in fact_dfs.values() if not d.empty), pd.DataFrame())
    )
    date_col = config.date_column or ""

    empty_envelope = {
        "recipe_id": recipe_id,
        "generated_at": generated_at,
        "row_count": 0,
        "approved": bool(recipe.approved_at),
        "active_filters": active_filters,
        "filter_options": filter_options,
        "metrics": [],
        "kpi_summaries": [],
        "time_series": {},
        "dimension_breakdowns": {},
        "dimension_spreads": {},
        "insights": [],
        "data_quality": {"status": "ok", "row_count": 0, "most_recent_date": None, "date_coverage": None, "warnings": ["No data rows found."]},
    }
    if not fact_dfs or all(df.empty for df in fact_dfs.values()):
        return empty_envelope

    if primary_df.empty:
        empty_envelope["active_filters"] = active_filters
        return empty_envelope

    def _df_for_kpi(kpi) -> "pd.DataFrame":
        uid = kpi_upload_map.get(kpi.name)
        return fact_dfs.get(uid, pd.DataFrame()) if uid is not None else pd.DataFrame()

    # KPI summaries
    kpi_summaries = []
    for kpi in config.kpis:
        kdf = _df_for_kpi(kpi)
        if kdf.empty:
            continue
        eval_formula = kpi.resolved_formula or kpi.formula
        series = _eval_kpi(kdf, eval_formula)
        if series is not None and series.notna().any():
            total = len(series)
            valid_count = int(series.notna().sum())
            null_count = total - valid_count
            kpi_summaries.append({
                "name": kpi.name,
                "formula": kpi.formula,
                "value": round(float(series.mean()), 2),
                "count": valid_count,
                "null_count": null_count,
                "null_pct": round(null_count / total * 100, 1) if total > 0 else 0.0,
            })

    # Time-series — each KPI's source df has __period__ from its own date column
    time_series: dict = {}
    for kpi in config.kpis:
        kdf = _df_for_kpi(kpi)
        if kdf.empty or "__period__" not in kdf.columns:
            continue
        series = _eval_kpi(kdf, kpi.resolved_formula or kpi.formula)
        if series is None or not series.notna().any():
            continue
        kdf = kdf.copy()
        kdf["__val__"] = series
        grouped = (
            kdf.groupby("__period__")["__val__"]
            .mean()
            .reset_index()
            .sort_values("__period__")
        )
        time_series[kpi.name] = [
            {"period": str(row["__period__"]), "value": round(float(row["__val__"]) if pd.notna(row["__val__"]) else 0.0, 2)}
            for _, row in grouped.iterrows()
        ]

    # Dimension breakdowns
    bar_entries = [
        c for c in config.chart_layout
        if c.type == "bar" and getattr(c, "show_breakdown", True)
    ]
    breakdown_kpi_names = {c.kpi for c in bar_entries} if bar_entries else {k.name for k in config.kpis}
    ordered_dims: list[str] = list(config.dimensions or [])
    breakdown_kpis = [k for k in config.kpis if k.name in breakdown_kpi_names] or config.kpis

    dimension_breakdowns: dict = {}
    dim_kpi_spreads: dict[str, list[float]] = {}

    for dim in ordered_dims:
        # Dimension column must exist in at least one fact df (all now joined with roster)
        if not any(dim in df.columns for df in fact_dfs.values() if not df.empty):
            continue
        dimension_breakdowns[dim] = {}
        dim_kpi_spreads[dim] = []
        for kpi in breakdown_kpis:
            kdf = _df_for_kpi(kpi)
            if kdf.empty or dim not in kdf.columns:
                continue
            series = _eval_kpi(kdf, kpi.resolved_formula or kpi.formula)
            if series is None or not series.notna().any():
                continue
            kdf = kdf.copy()
            kdf["__val__"] = series
            grouped_full = (
                kdf.groupby(dim)["__val__"]
                .mean()
                .reset_index()
                .sort_values("__val__", ascending=False)
            )
            full_values = grouped_full["__val__"].dropna().tolist()
            if len(full_values) >= 2:
                mean_val = sum(full_values) / len(full_values)
                if abs(mean_val) >= 1e-9:
                    dim_kpi_spreads[dim].append((max(full_values) - min(full_values)) / abs(mean_val))
            grouped = grouped_full.head(20)
            dimension_breakdowns[dim][kpi.name] = [
                {"name": str(row[dim]), "value": round(float(row["__val__"]) if pd.notna(row["__val__"]) else 0.0, 2)}
                for _, row in grouped.iterrows()
            ]

    dimension_spreads: dict[str, float] = {
        dim: round(sum(spreads) / len(spreads), 4) if spreads else 0.0
        for dim, spreads in dim_kpi_spreads.items()
    }
    dimension_breakdowns = dict(
        sorted(dimension_breakdowns.items(), key=lambda x: dimension_spreads.get(x[0], 0.0), reverse=True)
    )

    metrics = _build_metrics(kpi_summaries, time_series)
    insights = _generate_insights(metrics, dimension_breakdowns)
    data_quality = _assess_data_quality(primary_df, date_col)

    return {
        "recipe_id": recipe_id,
        "generated_at": generated_at,
        "row_count": len(primary_df),
        "approved": bool(recipe.approved_at),
        "filters": {"date_column": config.date_column, "granularity": config.granularity, "dimensions": config.dimensions},
        "filter_options": filter_options,
        "active_filters": active_filters,
        "metrics": metrics,
        "kpi_summaries": kpi_summaries,
        "time_series": time_series,
        "dimension_breakdowns": dimension_breakdowns,
        "dimension_spreads": dimension_spreads,
        "insights": insights,
        "data_quality": data_quality,
    }
