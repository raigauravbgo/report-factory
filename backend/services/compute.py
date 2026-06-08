"""
KPI computation engine.
Loads staging data, evaluates KPI formulas, and returns chart-ready series.
"""
import re
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from core.database import engine


def _load_staging_df(table_name: "str | list[str]") -> pd.DataFrame:
    """Load one or more staging tables and concatenate them.

    When multiple files are uploaded for the same dataset each file ends up in
    its own staging table with a different schema.  Concatenating with
    sort=False leaves columns not present in a given file as NaN — the
    pd.to_numeric(errors="coerce") calls downstream then naturally limit each
    KPI to the rows that actually carry the relevant columns.
    """
    names = [table_name] if isinstance(table_name, str) else list(table_name)
    with engine.connect() as conn:
        dfs = [pd.read_sql_table(n, con=conn) for n in names if n]
    if not dfs:
        return pd.DataFrame()
    if len(dfs) == 1:
        return dfs[0]
    return pd.concat(dfs, ignore_index=True, sort=False)


_EXCEL_EPOCH = pd.Timestamp("1899-12-30")
_EXCEL_DATE_MIN = 30000   # ~1982
_EXCEL_DATE_MAX = 60000   # ~2064


def _excel_serial_to_date(v: object) -> str:
    """Convert an Excel date serial integer to an ISO date string."""
    try:
        n = int(float(str(v)))
        if _EXCEL_DATE_MIN <= n <= _EXCEL_DATE_MAX:
            return (_EXCEL_EPOCH + pd.Timedelta(days=n)).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OverflowError):
        pass
    return str(v)


def _resample_rule(granularity: str) -> str:
    # "MS" (month-start) instead of "ME"/"M" avoids end-of-month bin edge cases
    # and works correctly when data spans only part of a single month.
    # "W-MON" anchors weeks to Monday for consistent reporting cadences.
    return {"daily": "D", "weekly": "W-MON", "monthly": "MS"}.get(granularity.lower(), "MS")


# Allow column names with spaces inside mean()/avg()/sum() — e.g. mean(Avg CSAT Rating)
_MEAN_RE = re.compile(r"^(?:mean|avg|average)\s*\(\s*(.+?)\s*\)$", re.IGNORECASE)
_SUM_RE   = re.compile(r"^sum\s*\(\s*(.+?)\s*\)$", re.IGNORECASE)
_COUNT_RE = re.compile(r"^count\s*\(\s*(.+?)\s*\)$", re.IGNORECASE)


_PCT_COL_RE = re.compile(r"\b(percent|pct)\b", re.IGNORECASE)


def _formula_agg(formula: str) -> str:
    """Return 'mean', 'sum', or 'ratio' based on the formula pattern."""
    if _MEAN_RE.match(formula.strip()):
        return "mean"
    if "/" in formula:
        return "ratio"
    # Percentage-type plain columns should be averaged, not summed
    if _PCT_COL_RE.search(formula.strip()):
        return "mean"
    return "sum"


def _infer_kpi_format(formula: str, kpi_format: str = "") -> str:
    """
    Infer the display format for a KPI.
    kpi_format is the format field from the recipe (if stored).
    Falls back to pattern matching on the formula.
    """
    if kpi_format:
        return kpi_format
    f = formula.lower()
    if "/" in formula or re.search(r"\b(percent|pct)\b", f):
        return "percentage"
    if re.search(r"\b(amount|revenue|cost|fee|charge|payment|spend)\b", f):
        return "currency"
    if re.search(r"\b(minutes|hours|duration|aht|aat|handle_time)\b", f):
        return "duration"
    if re.search(r"\b(count|total|volume|calls|contacts|cases|tickets)\b", f):
        return "integer"
    return "decimal"


def _resolve_col(name: str, df_cols: "pd.Index") -> str | None:
    """
    Resolve a column name against the dataframe, trying exact match first then
    a normalised (lowercase + non-word → underscore) fallback.
    Returns the actual column name present in df_cols, or None.
    """
    if name in df_cols:
        return name
    normalised = re.sub(r"[^\w]", "_", name.lower()).strip("_")
    normalised = re.sub(r"_+", "_", normalised)
    for col in df_cols:
        if col == normalised:
            return col
    return None


def _resolve_expr(expr: str, df: pd.DataFrame) -> "pd.Series | None":
    """
    Resolve a formula sub-expression to a numeric Series.
    Tries the full expression as a column name first (handles names with spaces/dots),
    then additive compound forms like "col_a + col_b", then word-token fallback.
    """
    clean = expr.strip().strip("()")
    col = _resolve_col(clean, df.columns)
    if col:
        return df[col].apply(pd.to_numeric, errors="coerce")
    terms = [t.strip() for t in re.split(r"\s*\+\s*", clean) if t.strip()]
    if len(terms) > 1:
        resolved = [_resolve_col(t, df.columns) for t in terms]
        if all(resolved):
            return df[resolved].apply(pd.to_numeric, errors="coerce").sum(axis=1)
    toks = [
        _resolve_col(c, df.columns)
        for c in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", clean)
    ]
    # Exclude any resolved column that isn't actually numeric — text/categorical
    # columns silently coerce to NaN and would corrupt compound expressions.
    toks = [c for c in toks if c and pd.api.types.is_numeric_dtype(df[c])]
    if toks:
        return df[toks].apply(pd.to_numeric, errors="coerce").sum(axis=1)
    return None


def _eval_formula(df: pd.DataFrame, formula: str) -> pd.Series:
    """
    Evaluate a KPI formula against a DataFrame row-by-row.
    Handles: mean(col), avg(col), sum(col), col/col, plain col.
    Column names with spaces or original casing are resolved via _resolve_col.
    """
    formula = formula.strip()

    # Direct column name (including names with spaces)
    resolved = _resolve_col(formula, df.columns)
    if resolved:
        return df[resolved].apply(pd.to_numeric, errors="coerce")

    # mean(col) / avg(col)
    m = _MEAN_RE.match(formula)
    if m:
        col = _resolve_col(m.group(1), df.columns)
        if col:
            return df[col].apply(pd.to_numeric, errors="coerce")
        return pd.Series(dtype=float)

    # count(col) — returns 1.0 per non-null row so that series.sum() == row count
    c = _COUNT_RE.match(formula)
    if c:
        col = _resolve_col(c.group(1), df.columns)
        if col:
            return df[col].notna().astype(float)
        return pd.Series(dtype=float)

    # sum(col)
    s = _SUM_RE.match(formula)
    if s:
        col = _resolve_col(s.group(1), df.columns)
        if col:
            return df[col].apply(pd.to_numeric, errors="coerce")
        return pd.Series(dtype=float)

    # Ratio formula: uses _resolve_expr to handle column names with spaces
    # and compound denominators like "col_a + col_b"
    if "/" in formula:
        parts = [p.strip() for p in formula.split("/", 1)]
        num = _resolve_expr(parts[0], df)
        den = _resolve_expr(parts[1], df)
        if num is not None and den is not None:
            return num / den.replace(0, pd.NA)
        return pd.Series(dtype=float)

    # Plain column name fallback (word-token extraction).
    # Only return a column if it actually contains numeric data — text/categorical
    # columns would silently coerce to all-NaN and corrupt the KPI value.
    for raw in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", formula):
        col = _resolve_col(raw, df.columns)
        if col and pd.api.types.is_numeric_dtype(df[col]):
            return df[col].apply(pd.to_numeric, errors="coerce")

    return pd.Series(dtype=float)


def get_filter_options(staging_table_name: "str | list[str]", columns: list[str]) -> dict[str, list[str]]:
    """Return distinct sorted values for each requested column (used to populate FilterBar dropdowns).

    Accepts a single table name or a list (multi-file datasets).  Integer values
    that fall in the Excel serial-date range are converted to ISO date strings so
    that columns like wb/we show human-readable dates instead of raw numbers.
    """
    df = _load_staging_df(staging_table_name)
    result: dict[str, list[str]] = {}
    for col in columns:
        if col in df.columns:
            raw_vals = df[col].dropna().unique().tolist()
            # Detect and convert Excel serial date integers (e.g. wb, we columns)
            numeric_raw: list[int | None] = []
            for v in raw_vals:
                try:
                    numeric_raw.append(int(float(str(v))))
                except (ValueError, TypeError):
                    numeric_raw.append(None)

            if all(n is not None and _EXCEL_DATE_MIN <= n <= _EXCEL_DATE_MAX for n in numeric_raw):
                # All values are Excel serial dates — convert to ISO strings
                str_vals = [_excel_serial_to_date(v) for v in raw_vals]
            else:
                # Default string conversion: render whole-number floats as integers
                str_vals = []
                for v in raw_vals:
                    try:
                        f = float(str(v))
                        str_vals.append(str(int(f)) if f == int(f) else str(v))
                    except (ValueError, TypeError):
                        str_vals.append(str(v))
            result[col] = sorted(str_vals)[:100]  # cap at 100 options per filter
    return result


def _pick_breakdown_dim(dimensions: list[str], df: "pd.DataFrame") -> "str | None":
    """Pick the best dimension for breakdown charts.

    Prefers low-cardinality columns that are present in the data and are not
    PII/identifier fields (email, id, etc.).  Falls back to the first available
    dimension if all candidates fail the cardinality check.
    """
    # Import here to avoid circular dependency
    from services.ai_interview import _is_bad_filter_col

    candidates = [d for d in dimensions if d in df.columns and not _is_bad_filter_col(d)]
    # Sort by cardinality ascending — smallest group count makes most readable charts
    candidates.sort(key=lambda d: df[d].nunique())
    for dim in candidates:
        if df[dim].nunique() <= 50:
            return dim
    # Fallback: any dimension present in the frame, even high-cardinality
    return next((d for d in dimensions if d in df.columns), None)


def _apply_filter_row(df: "pd.DataFrame", col: str, val: str) -> "pd.DataFrame":
    """Apply a single row-level filter, handling Excel serial-date columns correctly.

    The filter-values endpoint converts Excel serial integers to ISO date strings
    (e.g. 46110 → "2026-03-29").  When the user picks such a value the raw column
    still holds the integer, so a plain astype(str) comparison would never match.
    This function detects that case and compares on the original integer instead.
    """
    if col not in df.columns:
        return df
    col_series = df[col]
    # Detect Excel serial-date column: all non-null values are integers in serial range
    try:
        numeric = pd.to_numeric(col_series.dropna(), errors="coerce").dropna()
        if len(numeric) > 0 and bool(numeric.between(_EXCEL_DATE_MIN, _EXCEL_DATE_MAX).all()):
            try:
                serial = int((pd.Timestamp(val) - _EXCEL_EPOCH).days)
                return df[pd.to_numeric(col_series, errors="coerce") == serial]
            except Exception:
                pass
    except Exception:
        pass
    return df[col_series.astype(str) == val]


def validate_dashboard_config(
    recipe_config: dict,
    staging_table_name: "str | list[str]",
) -> dict:
    """
    Pre-flight data integrity check for a recipe configuration.

    Verifies:
    - Date column exists and contains parseable dates (DD-MM-YYYY, YYYY-MM-DD, Excel serial)
    - Chosen granularity produces at least 2 usable periods
    - Filter columns exist in the staging data with manageable cardinality
    - KPI formulas resolve to non-empty, non-all-null numeric series

    Returns
    -------
    {
        "valid": bool,
        "errors": [str],            # block dashboard render if non-empty
        "warnings": [str],          # informational — dashboard still renders
        "details": {
            "date_span_days": int | None,
            "missing_filter_columns": [str],
            "high_cardinality_filters": [str],
            "failing_kpi_formulas": [str],
        }
    }
    """
    df = _load_staging_df(staging_table_name)
    if df.empty:
        return {
            "valid": False,
            "errors": ["Staging data is empty — re-upload the file."],
            "warnings": [],
            "details": {},
        }

    errors: list[str] = []
    warnings: list[str] = []
    details: dict = {
        "date_span_days": None,
        "missing_filter_columns": [],
        "high_cardinality_filters": [],
        "failing_kpi_formulas": [],
    }

    date_col = recipe_config.get("date_column")
    granularity = (recipe_config.get("granularity") or "monthly").lower()

    # ── Date column ──────────────────────────────────────────────────────
    if date_col:
        if date_col not in df.columns:
            errors.append(
                f"Date column '{date_col}' not found in data. "
                f"Available columns: {list(df.columns[:10])}"
            )
        else:
            sample = df[date_col].dropna().head(200)
            as_numeric = pd.to_numeric(sample, errors="coerce")
            excel_mask = as_numeric.notna() & as_numeric.between(_EXCEL_DATE_MIN, _EXCEL_DATE_MAX)

            if excel_mask.all():
                parse_rate = 1.0  # Excel serials are always valid
            else:
                # Try dayfirst (DD-MM-YYYY) then generic mixed
                parsed = pd.to_datetime(sample.astype(str), errors="coerce", dayfirst=True)
                parse_rate = float(parsed.notna().mean())
                if parse_rate < 0.5:
                    # Try ISO / mixed format as fallback
                    parsed2 = pd.to_datetime(sample.astype(str), errors="coerce", format="mixed")
                    parse_rate = float(parsed2.notna().mean())

            if parse_rate < 0.5:
                errors.append(
                    f"Date column '{date_col}' cannot be parsed as dates "
                    f"({parse_rate:.0%} valid values). "
                    "Supported formats: DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY, Excel serial."
                )
            elif parse_rate < 0.8:
                warnings.append(
                    f"Date column '{date_col}' has {(1 - parse_rate):.0%} unparseable values — "
                    "those rows are excluded from time-series charts."
                )

            # Granularity compatibility
            if parse_rate >= 0.5:
                try:
                    all_dates = pd.to_datetime(
                        df[date_col].dropna(), errors="coerce", dayfirst=True
                    ).dropna()
                    if len(all_dates) >= 2:
                        span_days = int((all_dates.max() - all_dates.min()).days)
                        details["date_span_days"] = span_days
                        _thresholds = {"daily": (2, 7), "weekly": (14, 28), "monthly": (28, 60)}
                        warn_days, ok_days = _thresholds.get(granularity, (28, 60))
                        if span_days < warn_days:
                            errors.append(
                                f"Data spans only {span_days} day(s) — {granularity} granularity "
                                "will produce 0 or 1 period. Switch granularity or upload more data."
                            )
                        elif span_days < ok_days:
                            warnings.append(
                                f"Data spans {span_days} day(s) — {granularity} charts may have "
                                "very few data points."
                            )
                    else:
                        warnings.append(
                            f"Date column '{date_col}' has fewer than 2 valid values — "
                            "time-series charts cannot be generated."
                        )
                except Exception:
                    pass
    else:
        warnings.append("No date column configured — time-series and trend charts will not appear.")

    # ── Filter columns ───────────────────────────────────────────────────
    missing: list[str] = []
    high_card: list[str] = []
    for f in recipe_config.get("filters", []):
        if f not in df.columns:
            missing.append(f)
        else:
            n = int(df[f].nunique())
            if n > 100:
                high_card.append(f"{f} ({n} unique values)")

    if missing:
        errors.append(f"Filter column(s) not found in staging data: {missing}")
    if high_card:
        warnings.append(
            "Filter column(s) have very high cardinality — dropdowns may be unusable: "
            + ", ".join(high_card)
        )
    details["missing_filter_columns"] = missing
    details["high_cardinality_filters"] = [h.split(" (")[0] for h in high_card]

    # ── KPI formulas ─────────────────────────────────────────────────────
    failing: list[str] = []
    for kpi in recipe_config.get("kpis", []):
        formula = kpi.get("formula", "").strip()
        if not formula:
            continue
        series = _eval_formula(df, formula)
        if series.empty or series.isna().all():
            failing.append(f"{kpi.get('name', '?')} — {formula}")

    if failing:
        errors.append(
            "KPI formula(s) produce no data (unknown or non-numeric columns): "
            + "; ".join(failing)
        )
    details["failing_kpi_formulas"] = failing

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "details": details,
    }


def compute_dashboard(recipe_config: dict, staging_table_name: "str | list[str]",
                      filters: dict[str, str] | None = None,
                      granularity_override: "str | None" = None) -> dict:
    """
    Given a recipe config and the staging table name(s), compute KPI time series.

    Parameters
    ----------
    recipe_config       : recipe config dict (kpis, date_column, granularity, dimensions …)
    staging_table_name  : single table name or list of names (multi-file datasets)
    filters             : active row-level filter values {col: value}
    granularity_override: if provided, overrides recipe_config["granularity"]
                          (used by the dashboard granularity toggle)
    """
    # Pre-flight: log integrity issues so they appear in server logs
    _preflight = validate_dashboard_config(recipe_config, staging_table_name)
    for _e in _preflight.get("errors", []):
        logger.warning("COMPUTE_PREFLIGHT error: %s", _e)
    for _w in _preflight.get("warnings", []):
        logger.info("COMPUTE_PREFLIGHT warning: %s", _w)

    df = _load_staging_df(staging_table_name)
    if df.empty:
        return {"kpi_summaries": [], "time_series": [], "breakdown": []}

    # Apply row-level filters — handles Excel serial-date columns transparently
    if filters:
        for col, val in filters.items():
            if val:
                df = _apply_filter_row(df, col, val)
        if df.empty:
            return {"kpi_summaries": [], "time_series": [], "breakdown": [], "insights": []}

    date_col = recipe_config.get("date_column")
    granularity = (granularity_override or recipe_config.get("granularity", "monthly")).lower()
    kpis = recipe_config.get("kpis", [])
    dimensions = recipe_config.get("dimensions", [])

    # Parse date column — handles three cases per row:
    #   1. Numeric value in Excel serial range (e.g. 46110 → 2026-04-01)
    #   2. Datetime string / proper datetime (pd.to_datetime handles it)
    #   3. Anything else → NaT (dropped below)
    # Two-pass approach so mixed columns (staging tables from multi-file datasets
    # with different date storage formats) are handled correctly.
    if date_col and date_col in df.columns:
        as_numeric = pd.to_numeric(df[date_col], errors="coerce")
        excel_mask = as_numeric.notna() & as_numeric.between(_EXCEL_DATE_MIN, _EXCEL_DATE_MAX)

        result_dates = pd.to_datetime(df[date_col], errors="coerce")
        if excel_mask.any():
            result_dates = result_dates.copy()
            result_dates[excel_mask] = (
                _EXCEL_EPOCH + pd.to_timedelta(as_numeric[excel_mask].astype(int), unit="D")
            )
        df[date_col] = result_dates
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
        # ratio_of_sums: sum(numerator)/sum(denominator) per period — avoids per-row averaging bias
        is_ros = kpi.get("aggregation") == "ratio_of_sums" and "/" in formula

        if is_ros:
            ros_parts = [p.strip() for p in formula.split("/", 1)]
            num_s = _resolve_expr(ros_parts[0], df)
            den_s = _resolve_expr(ros_parts[1], df)
            if num_s is None or den_s is None or num_s.empty or den_s.empty:
                kpi_summaries.append({"name": name, "value": None, "formula": formula})
                continue
            den_total = float(den_s.sum())
            overall = float(num_s.sum()) / den_total if den_total != 0 else None
            series = num_s / den_s.replace(0, pd.NA)
            agg = "ratio_of_sums"
        else:
            series = _eval_formula(df, formula)
            if series.empty:
                kpi_summaries.append({"name": name, "value": None, "formula": formula})
                continue
            agg = _formula_agg(formula)
            raw_val = series.mean() if agg in ("mean", "ratio") else series.sum()
            overall = None if pd.isna(raw_val) else float(raw_val)

        if overall is None:
            kpi_summaries.append({"name": name, "value": None, "formula": formula,
                                   "format": _infer_kpi_format(formula, kpi.get("format", ""))})
            continue

        kpi_summaries.append({
            "name": name,
            "value": round(overall, 4),
            "formula": formula,
            "format": _infer_kpi_format(formula, kpi.get("format", "")),
        })

        # Time series (resampled)
        if date_col:
            if is_ros:
                resampled = (
                    num_s.resample(rule).sum()
                    / den_s.resample(rule).sum().replace(0, pd.NA)
                ).dropna()
            else:
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

        # Breakdown by best available dimension (lowest cardinality, not PII)
        df_reset = df.reset_index() if date_col else df
        dim = _pick_breakdown_dim(dimensions, df_reset)
        if dim and dim in df_reset.columns:
            if is_ros:
                _fp = [p.strip() for p in formula.split("/", 1)]
                def _ros_group(g, fp=_fp):
                    n = _resolve_expr(fp[0], g)
                    d = _resolve_expr(fp[1], g)
                    if n is None or d is None:
                        return pd.NA
                    d_sum = d.sum()
                    return float(n.sum() / d_sum) if d_sum != 0 else pd.NA
                grouped = df_reset.groupby(dim).apply(_ros_group, include_groups=False).dropna()
            else:
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
