"""
KPI computation engine.
Loads staging data, evaluates KPI formulas, and returns chart-ready series.
"""
import json
import logging
import re
import time as _time
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from core.database import engine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory DataFrame cache — avoids re-reading SQLite on every filter toggle
# or page reload.  Staging data is stable between uploads; TTL provides a
# safety valve in case a table is replaced (re-upload creates a new staging_N
# name so the cache key changes automatically).
# ---------------------------------------------------------------------------
_STAGING_CACHE_TTL = 120  # seconds — safe for interactive use; stale entries
                           # are evicted passively on next miss or on expiry.
_staging_cache: dict[tuple, tuple[float, pd.DataFrame]] = {}


def _staging_cache_key(
    names: list[str],
    confirmed_relationships: "list[dict] | None",
    upload_table_map: "dict[str, str] | None",
    filter_cols: "list[str] | None",
    date_column: "str | None",
) -> tuple:
    return (
        tuple(sorted(names)),
        json.dumps(confirmed_relationships or [], sort_keys=True),
        json.dumps(upload_table_map or {}, sort_keys=True),
        tuple(sorted(filter_cols or [])),
        date_column or "",
    )


def invalidate_staging_cache(table_names: "list[str] | None" = None) -> None:
    """Evict cache entries that reference any of the given table names.

    Called after a re-upload so the next request reads fresh data.
    Pass None to clear the entire cache (e.g. during testing).
    """
    global _staging_cache
    if table_names is None:
        _staging_cache = {}
        return
    _staging_cache = {
        k: v for k, v in _staging_cache.items()
        if not any(n in k[0] for n in table_names)
    }


def _find_time_key_col(table_name: str) -> "str | None":
    """Return the first time_key-tagged column name for a staging table from its profile_data.

    Used to remap a table's date column when it doesn't match the recipe's date_column.
    Queries the DB — called only when a table is actually missing the expected date column.
    """
    from core.database import SessionLocal
    from models.staging_table import StagingTable
    db = SessionLocal()
    try:
        st = db.query(StagingTable).filter(StagingTable.table_name == table_name).first()
        if not st or not st.profile_data:
            return None
        for col in st.profile_data.get("columns", []):
            if col.get("semantic_tag") == "time_key":
                return col["name"]
        return None
    finally:
        db.close()


def _load_staging_df(
    table_name: "str | list[str]",
    confirmed_relationships: "list[dict] | None" = None,
    upload_table_map: "dict[str, str] | None" = None,
    filter_cols: "list[str] | None" = None,
    date_column: "str | None" = None,
) -> pd.DataFrame:
    """Load one or more staging tables.

    When confirmed PK/FK relationships exist, JOIN the fact table to dimension
    tables using those relationships.  Without relationships (or for same-grain
    files), fall back to pd.concat so columns from all files are available.

    When date_column is provided and a table is missing that column, the function
    looks up the table's profile_data for a time_key-tagged column and renames it
    so QA/grading tables with different date column names (e.g. date_graded instead
    of date) still contribute rows to time-series charts.

    Parameters
    ----------
    table_name             : one table name or list of names (multi-file datasets)
    confirmed_relationships: from recipe_config["confirmed_relationships"]
    upload_table_map       : from recipe_config["upload_table_map"] — maps
                             filename → staging table name so relationship
                             file_a/file_b names resolve to physical tables
    date_column            : recipe date column name; triggers per-table remapping
                             when a table uses a different column for its date
    """
    names = [table_name] if isinstance(table_name, str) else list(table_name)

    # Check in-memory cache before hitting SQLite.
    _ck = _staging_cache_key(names, confirmed_relationships, upload_table_map, filter_cols, date_column)
    _now = _time.monotonic()
    if _ck in _staging_cache:
        _ts, _cached = _staging_cache[_ck]
        if _now - _ts < _STAGING_CACHE_TTL:
            logger.debug("_load_staging_df: cache hit for %s", names)
            return _cached

    with engine.connect() as conn:
        dfs = []
        for n in names:
            if not n:
                continue
            chunk = pd.read_sql_table(n, con=conn)
            # If this table is missing the recipe's date column, find the time_key
            # column from profile_data and rename it so the rows get a date after concat.
            if date_column and date_column not in chunk.columns:
                time_key = _find_time_key_col(n)
                if time_key and time_key in chunk.columns:
                    chunk = chunk.rename(columns={time_key: date_column})
                    logger.info(
                        "_load_staging_df: remapped %r → %r for table %s",
                        time_key, date_column, n,
                    )
            dfs.append(chunk)
    if not dfs:
        return pd.DataFrame()
    if len(dfs) == 1:
        _staging_cache[_ck] = (_time.monotonic(), dfs[0])
        return dfs[0]

    # Always enrich per-table FIRST so every table gets the filter/breakdown
    # columns before any join or concat.  This is required even when
    # confirmed_relationships is present: same_dimension relationships fall back
    # to plain concat inside _apply_relationships, so without pre-enrichment
    # tables like QA (which lack location/department) would still have NaN values
    # and produce empty breakdown charts.
    if filter_cols and len(dfs) >= 2:
        dfs = _enrich_dfs(dfs, names, filter_cols)

    # Apply PK/FK-aware joins when the caller supplies relationship context.
    if confirmed_relationships and upload_table_map:
        result = _apply_relationships(dfs, names, confirmed_relationships, upload_table_map)
    else:
        result = pd.concat(dfs, ignore_index=True, sort=False)

    _staging_cache[_ck] = (_time.monotonic(), result)
    return result


def _find_cross_name_join_key(
    left_df: pd.DataFrame,
    donor_df: pd.DataFrame,
    min_overlap: float = 0.65,
    sample_size: int = 200,
) -> "tuple[str, str] | None":
    """Return (left_col, donor_col) with the highest value-overlap, or None.

    Used when exact priority-key name matching fails — e.g. Roster.email and
    CSAT.agent_email contain the same email addresses under different column names.
    Only considers non-numeric columns; the overlap threshold is the sole guard
    against false positives.  We intentionally skip any cardinality upper-bound
    filter because identifier columns (emails, IDs) naturally have high cardinality
    in dimension tables (e.g. Roster.email where every row is unique).

    Parameters
    ----------
    left_df      : DataFrame that needs enrichment (e.g. df_csat)
    donor_df     : DataFrame that has the filter column (e.g. df_roster)
    min_overlap  : minimum fraction of left_col values that must appear in donor_col
    sample_size  : max rows sampled from left_col for the overlap check
    """
    best: "tuple[str, str, float] | None" = None

    for lc in left_df.columns:
        if pd.api.types.is_numeric_dtype(left_df[lc]):
            continue
        left_sample = set(left_df[lc].dropna().astype(str).unique()[:sample_size])
        if not left_sample:
            continue
        for rc in donor_df.columns:
            if rc == lc:
                continue  # skip identical names — handled by priority-key path
            if pd.api.types.is_numeric_dtype(donor_df[rc]):
                continue
            donor_vals = set(donor_df[rc].dropna().astype(str))
            if not donor_vals:
                continue
            overlap = len(left_sample & donor_vals) / len(left_sample)
            if overlap >= min_overlap:
                if best is None or overlap > best[2]:
                    best = (lc, rc, overlap)

    if best:
        logger.info(
            "CROSS_NAME_JOIN_KEY left_col=%s donor_col=%s overlap=%.2f",
            best[0], best[1], best[2],
        )
        return (best[0], best[1])
    return None


def _enrich_dfs(
    dfs: "list[pd.DataFrame]",
    table_names: "list[str]",
    filter_cols: "list[str]",
) -> "list[pd.DataFrame]":
    """Per-table enrichment — returns the enriched list without concatenating.

    Used by both _apply_same_dimension_enrichment (plain concat path) and
    _load_staging_df (which may further apply pk_fk relationships on the list).

    Left-joins filter columns from sibling tables into tables that lack them
    so that every table has the columns needed for filtering and breakdown charts.

    Join key detection is fully data-driven — no column names are hardcoded:

    Step 1 — same-name: shared non-float columns ranked by cardinality.
        High cardinality = identifier (email, ID); low = category (location, dept).
        Float columns are skipped (they are measures, not identifiers), but
        integer ID columns are included.

    Step 2 — cross-name: value-overlap probe via _find_cross_name_join_key.
        Used when no same-name joinable column exists — e.g. Roster.email and
        CSAT.agent_email are the same data under different names.
    """

    def _joinable(series: "pd.Series") -> bool:
        """True for columns usable as join keys: non-float, non-datetime strings/integer IDs.
        Date columns are excluded — they have high cardinality but wrong semantics for lookup joins.
        """
        return (
            not pd.api.types.is_float_dtype(series)
            and not pd.api.types.is_datetime64_any_dtype(series)
        )

    def _donor_join_strength(candidate_j: int, left_df: "pd.DataFrame") -> int:
        donor_df = dfs[candidate_j]
        shared = [
            k for k in left_df.columns
            if k in donor_df.columns
            and _joinable(left_df[k])
            and _joinable(donor_df[k])
        ]
        return -max((int(left_df[k].nunique()) for k in shared), default=0)

    enriched = list(dfs)

    for i, df in enumerate(dfs):
        missing = [c for c in filter_cols if c not in df.columns]
        if not missing:
            continue

        all_covering = [
            j for j, other in enumerate(dfs)
            if j != i and all(c in other.columns for c in missing)
        ]
        if all_covering:
            best_j = min(
                all_covering,
                key=lambda j: (
                    _donor_join_strength(j, enriched[i]),
                    -sum(int(dfs[j][c].nunique()) for c in missing),
                ),
            )
            donor_to_cols: dict[int, list[str]] = {best_j: list(missing)}
        else:
            col_to_donor: dict[str, int] = {}
            for col in missing:
                best_card = -1
                best_j2: int | None = None
                for j, other in enumerate(dfs):
                    if j == i or col not in other.columns:
                        continue
                    card = int(other[col].nunique())
                    if card > best_card:
                        best_card = card
                        best_j2 = j
                if best_j2 is not None:
                    col_to_donor[col] = best_j2
                else:
                    logger.debug(
                        "ENRICH_SKIP table=%s col=%s — no sibling has this column",
                        table_names[i], col,
                    )
            donor_to_cols = {}
            for col, donor_j in col_to_donor.items():
                donor_to_cols.setdefault(donor_j, []).append(col)

        for donor_j, cols_to_add in donor_to_cols.items():
            donor = dfs[donor_j]

            shared = [
                k for k in enriched[i].columns
                if k in donor.columns
                and _joinable(enriched[i][k])
                and _joinable(donor[k])
            ]
            same_key: str | None = (
                max(shared, key=lambda k: int(enriched[i][k].nunique())) if shared else None
            )
            same_card = int(enriched[i][same_key].nunique()) if same_key else 0

            # Always probe for a cross-name key; prefer it when it gives higher entity
            # resolution than the best same-name key (e.g. agent_email→email cardinality
            # ~1000 beats pod→pod cardinality ~12, yielding correct agent-level joins).
            cross = _find_cross_name_join_key(enriched[i], donor)
            cross_key        = cross[0] if cross else None
            cross_donor_key  = cross[1] if cross else None
            # Measure donor-side cardinality for the cross-name key so the comparison
            # is apples-to-apples: same_card measures left-table values, so we use the
            # donor table's cross_donor_key cardinality (same entity set, correct side).
            cross_card       = int(donor[cross_donor_key].nunique()) if cross_donor_key else 0

            cross_rename: "str | None" = None
            if cross_key and cross_card > same_card:
                join_key     = cross_key
                cross_rename = cross_donor_key
            else:
                join_key = same_key

            if join_key is None:
                logger.debug(
                    "ENRICH_SKIP table=%s cols=%s — no join key found with donor index %d",
                    table_names[i], cols_to_add, donor_j,
                )
                continue

            # Exclude cross_rename from cols_to_add to prevent duplicate columns.
            # When the donor join key column (e.g. Roster.email) is also a requested
            # filter column (e.g. recipe dimension "email"), it would appear twice in
            # lookup_cols_donor: once as the explicit join key and once via cols_to_add.
            # pandas df[[col, col, ...]] returns a DataFrame with two identically-named
            # columns, and after rename both become join_key — lookup[join_key].dtype
            # then raises AttributeError because it returns a DataFrame not a Series.
            safe_cols_to_add = [c for c in cols_to_add if c != cross_rename]
            lookup_cols_donor = ([cross_rename] if cross_rename else [join_key]) + safe_cols_to_add
            lookup = donor[[c for c in lookup_cols_donor if c in donor.columns]].drop_duplicates(
                subset=[cross_rename if cross_rename else join_key]
            ).copy()
            if cross_rename:
                lookup = lookup.rename(columns={cross_rename: join_key})
            left_df = enriched[i].copy()
            if left_df[join_key].dtype != lookup[join_key].dtype:
                left_df[join_key] = left_df[join_key].astype(str)
                lookup[join_key] = lookup[join_key].astype(str)
            enriched[i] = left_df.merge(lookup, on=join_key, how="left", suffixes=("", "_enr"))
            # If the donor join key was itself a requested filter column (e.g. "email"),
            # create an alias on the enriched table so that filters on that column name work.
            # The join key column on left_df (e.g. "affirm_email") holds the same values.
            if cross_rename and cross_rename in cols_to_add and cross_rename not in enriched[i].columns:
                enriched[i][cross_rename] = enriched[i][join_key]
            logger.info(
                "ENRICH table=%s cols=%s via join_key=%s from donor index %d",
                table_names[i], cols_to_add, join_key, donor_j,
            )

    # Pass 2: transitive enrichment — tables still missing filter_cols after the main
    # pass can pull from already-enriched siblings via same-name join keys.
    # Example: QA shares no column name with Roster but enriched-CSAT has both
    # agent_email (same name as QA) and one_up_manager (pulled from Roster in pass 1).
    for i in range(len(enriched)):
        still_missing = [c for c in filter_cols if c not in enriched[i].columns]
        if not still_missing:
            continue
        for j, enriched_donor in enumerate(enriched):
            if j == i or not all(c in enriched_donor.columns for c in still_missing):
                continue
            shared2 = [
                k for k in enriched[i].columns
                if k in enriched_donor.columns
                and _joinable(enriched[i][k])
                and _joinable(enriched_donor[k])
            ]
            if not shared2:
                continue
            key2 = max(shared2, key=lambda k: int(enriched[i][k].nunique()))
            lookup2 = (
                enriched_donor[[key2] + still_missing]
                .drop_duplicates(subset=[key2])
                .copy()
            )
            left2 = enriched[i].copy()
            if left2[key2].dtype != lookup2[key2].dtype:
                left2[key2] = left2[key2].astype(str)
                lookup2[key2] = lookup2[key2].astype(str)
            enriched[i] = left2.merge(lookup2, on=key2, how="left", suffixes=("", "_enr"))
            logger.info(
                "ENRICH_PASS2 table=%s cols=%s via key=%s from enriched index=%d",
                table_names[i], still_missing, key2, j,
            )
            break  # all still_missing cols obtained from this donor

    return enriched


def _apply_same_dimension_enrichment(
    dfs: "list[pd.DataFrame]",
    table_names: "list[str]",
    filter_cols: "list[str]",
) -> pd.DataFrame:
    """Enrich tables and return a single concatenated DataFrame."""
    return pd.concat(_enrich_dfs(dfs, table_names, filter_cols), ignore_index=True, sort=False)


def _apply_relationships(
    dfs: "list[pd.DataFrame]",
    table_names: "list[str]",
    confirmed_relationships: "list[dict]",
    upload_table_map: "dict[str, str]",
) -> pd.DataFrame:
    """Join DataFrames using confirmed PK/FK relationships.

    Strategy
    --------
    For each ``pk_fk`` relationship in *confirmed_relationships*:
    - ``file_b`` (FK side / fact table) is LEFT-JOINed to ``file_a`` (PK side
      / dimension table) on the stated columns.
    - The fact table accumulates dimension columns without duplicating rows.

    For ``same_dimension`` and ``shared_key`` relationships (same grain),
    tables are stacked with ``pd.concat`` as before.

    Any tables not involved in a pk_fk join are appended via concat so no
    data is lost.

    Example
    -------
    File A: agents.xlsx  — agent_id (PK), agent_name, team
    File B: calls.xlsx   — agent_id (FK), call_date, duration

    Result: calls.xlsx LEFT JOIN agents.xlsx ON agent_id
    → one row per call, enriched with agent_name and team columns.
    """
    if not confirmed_relationships or len(dfs) < 2:
        return pd.concat(dfs, ignore_index=True, sort=False)

    # table_name → DataFrame lookup
    table_df_map: dict[str, pd.DataFrame] = dict(zip(table_names, dfs))

    # Collect pk_fk join instructions (skip non-pk_fk relationship types).
    # For each candidate, cardinality ratios determine:
    #   1. Whether either side is a valid PK (ratio >= 0.5).  If max(ratio_a, ratio_b)
    #      is below 0.5, both columns are low-cardinality (e.g. date, category) and
    #      joining them would produce a many-to-many cartesian explosion — skip.
    #   2. Which side is the PK/dimension (higher ratio).  The stored file_a/file_b
    #      ordering is not always correct (schema_relationships may have emitted the
    #      pair in alphabetical or detection order), so we auto-correct direction.
    pk_fk_joins: list[dict] = []
    for rel in confirmed_relationships:
        if rel.get("relationship_type") != "pk_fk":
            continue
        tbl_a = upload_table_map.get(rel.get("file_a", ""))
        tbl_b = upload_table_map.get(rel.get("file_b", ""))
        col_a = rel.get("col_a", "")
        col_b = rel.get("col_b", "")
        if not (tbl_a and tbl_b and col_a and col_b
                and tbl_a in table_df_map and tbl_b in table_df_map):
            continue

        df_a = table_df_map[tbl_a]
        df_b = table_df_map[tbl_b]
        ratio_a = (df_a[col_a].nunique() / max(len(df_a), 1)
                   if col_a in df_a.columns else 0.0)
        ratio_b = (df_b[col_b].nunique() / max(len(df_b), 1)
                   if col_b in df_b.columns else 0.0)

        # Neither side is unique enough to be a PK → same-grain columns (e.g. date,
        # location, day-of-week).  Joining would create a cartesian explosion; skip.
        if max(ratio_a, ratio_b) < 0.5:
            logger.info(
                "SKIP_FK_JOIN %s.%s(ratio=%.3f) ↔ %s.%s(ratio=%.3f): "
                "max cardinality ratio %.3f < 0.5 — treating as same-grain (concat, not join).",
                tbl_a, col_a, ratio_a, tbl_b, col_b, ratio_b, max(ratio_a, ratio_b),
            )
            continue

        # The higher-ratio side is the PK/dimension; auto-correct stored direction.
        if ratio_a >= ratio_b:
            fact_t, dim_t, fact_c, dim_c = tbl_b, tbl_a, col_b, col_a
        else:
            logger.info(
                "FLIP_FK_JOIN %s.%s(ratio=%.3f) < %s.%s(ratio=%.3f): "
                "stored file_a has lower cardinality — flipping so higher side is dimension.",
                tbl_a, col_a, ratio_a, tbl_b, col_b, ratio_b,
            )
            fact_t, dim_t, fact_c, dim_c = tbl_a, tbl_b, col_a, col_b

        pk_fk_joins.append({"fact": fact_t, "dim": dim_t, "fact_col": fact_c, "dim_col": dim_c})
        logger.info(
            "RELATIONSHIP_JOIN fact=%s.%s FK→PK=%s.%s",
            fact_t, fact_c, dim_t, dim_c,
        )

    if not pk_fk_joins:
        # No valid pk_fk relationships resolved — fall back to concat
        logger.info("_apply_relationships: no pk_fk joins resolved, falling back to concat")
        return pd.concat(dfs, ignore_index=True, sort=False)

    # Group joins by fact table so every fact table gets its own dimension join.
    # The old single-fact approach only joined pk_fk_joins[0]["fact"], leaving
    # every other fact table in the concat remainder without dimension columns.
    fact_joins: dict[str, list[dict]] = {}
    for join in pk_fk_joins:
        fact_joins.setdefault(join["fact"], []).append(join)

    enriched_facts: list[pd.DataFrame] = []
    all_joined: set[str] = set()

    for fact_tbl, joins in fact_joins.items():
        fact_df = table_df_map[fact_tbl].copy()
        joined_dims: set[str] = set()
        for join in joins:
            dim_name = join["dim"]
            if dim_name in joined_dims or dim_name not in table_df_map:
                continue
            dim_df = table_df_map[dim_name]
            # Only bring in columns the fact table doesn't already have (avoid duplicates).
            new_cols = [c for c in dim_df.columns if c != join["dim_col"] and c not in fact_df.columns]
            merge_df = dim_df[[join["dim_col"]] + new_cols]
            fact_df = fact_df.merge(
                merge_df,
                left_on=join["fact_col"],
                right_on=join["dim_col"],
                how="left",
                suffixes=("", f"_{dim_name}"),
            )
            joined_dims.add(dim_name)
            logger.info(
                "RELATIONSHIP_JOIN merged dim=%s (%d new cols) into fact=%s → %d rows",
                dim_name, len(new_cols), fact_tbl, len(fact_df),
            )
        enriched_facts.append(fact_df)
        all_joined.add(fact_tbl)
        all_joined.update(joined_dims)

    # Any table not covered by any pk_fk join is stacked (same-grain concat).
    remaining = [df for name, df in table_df_map.items() if name not in all_joined]
    all_dfs = enriched_facts + remaining
    if len(all_dfs) == 1:
        return all_dfs[0]
    return pd.concat(all_dfs, ignore_index=True, sort=False)


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


_TIME_TOKENS: frozenset[str] = frozenset({
    "month", "week", "year", "quarter", "day", "hour", "period", "fiscal", "fy",
})


def _is_time_derived_col(col: str) -> bool:
    """Return True if the column looks like a date-part (month, week, year, etc.)."""
    parts = re.split(r"[_\-\s]+", col.lower())
    return bool(_TIME_TOKENS.intersection(parts))


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


def _norm_col(s: str) -> str:
    """Lowercase + collapse non-alphanumeric runs to single underscore."""
    return re.sub(r"_+", "_", re.sub(r"[^\w]", "_", s.lower())).strip("_")


def _resolve_col(name: str, df_cols: "pd.Index") -> str | None:
    """
    Resolve a column name against the dataframe.
    Tries exact match first, then normalised (lowercase + non-word → underscore)
    comparison on BOTH sides so that 'rubric_score' matches 'Rubric Score' and
    'Avg Handle Time' matches 'avg_handle_time'.
    Returns the actual column name present in df_cols, or None.
    """
    if name in df_cols:
        return name
    normalised = _norm_col(name)
    for col in df_cols:
        if _norm_col(col) == normalised:
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
        return pd.to_numeric(df[col], errors="coerce")
    terms = [t.strip() for t in re.split(r"\s*\+\s*", clean) if t.strip()]
    if len(terms) > 1:
        resolved = [_resolve_col(t, df.columns) for t in terms]
        if all(resolved):
            return sum(pd.to_numeric(df[c], errors="coerce") for c in resolved)
    toks = [
        _resolve_col(c, df.columns)
        for c in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", clean)
    ]
    # Exclude any resolved column that isn't actually numeric — text/categorical
    # columns silently coerce to NaN and would corrupt compound expressions.
    toks = [c for c in toks if c and pd.api.types.is_numeric_dtype(df[c])]
    if toks:
        return sum(pd.to_numeric(df[c], errors="coerce") for c in toks)
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
        return pd.to_numeric(df[resolved], errors="coerce")

    # mean(col) / avg(col)
    m = _MEAN_RE.match(formula)
    if m:
        col = _resolve_col(m.group(1), df.columns)
        if col:
            return pd.to_numeric(df[col], errors="coerce")
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
            return pd.to_numeric(df[col], errors="coerce")
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
            return pd.to_numeric(df[col], errors="coerce")

    return pd.Series(dtype=float)


def get_filter_options(
    staging_table_name: "str | list[str]",
    columns: list[str],
    confirmed_relationships: "list[dict] | None" = None,
    upload_table_map: "dict[str, str] | None" = None,
    active_filters: "dict[str, str] | None" = None,
    date_column: "str | None" = None,
) -> dict[str, list[str]]:
    """Return distinct sorted values for each filter column (used to populate FilterBar dropdowns).

    Cascading filter logic (Power BI-style):
      For each column, options are computed from the dataset filtered by ALL OTHER currently
      active filters — but NOT the column's own filter.  This means selecting
      location=India narrows the department dropdown to only departments that exist within
      India, while the location dropdown still shows all available locations so the user
      can change their selection.

    Fact-only values:
      If date_column is provided, rows missing that column are dropped after loading.
      This mirrors compute_dashboard's dropna behaviour and excludes dimension/roster rows
      that have no date (e.g. a Roster table's location=India where no fact rows match).

    Enrichment:
      The DataFrame is loaded with the same enrichment as compute_dashboard so filter
      options only reflect values that actually exist in fact-table rows.

    Integer values in the Excel serial-date range are converted to ISO date strings.
    """
    df_base = _load_staging_df(
        staging_table_name,
        confirmed_relationships=confirmed_relationships,
        upload_table_map=upload_table_map,
        filter_cols=columns if columns else None,
        date_column=date_column,
    )

    # Drop rows with no date value — these are pure dimension/roster rows that
    # would otherwise inject dimension-only filter values (e.g. location=India
    # from a Roster table when no fact rows carry that location).
    if date_column and date_column in df_base.columns:
        df_base = df_base.dropna(subset=[date_column])

    def _raw_to_str_vals(raw_vals: list) -> list[str]:
        numeric_raw: list[int | None] = []
        for v in raw_vals:
            try:
                numeric_raw.append(int(float(str(v))))
            except (ValueError, TypeError):
                numeric_raw.append(None)
        if all(n is not None and _EXCEL_DATE_MIN <= n <= _EXCEL_DATE_MAX for n in numeric_raw):
            return [_excel_serial_to_date(v) for v in raw_vals]
        str_vals: list[str] = []
        for v in raw_vals:
            try:
                f = float(str(v))
                str_vals.append(str(int(f)) if f == int(f) else str(v))
            except (ValueError, TypeError):
                str_vals.append(str(v))
        return str_vals

    result: dict[str, list[str]] = {}
    for col in columns:
        if col not in df_base.columns:
            continue
        # Apply all active filters EXCEPT this column's own filter so the user can
        # still see and change their current selection (Power BI cascade behaviour).
        df_col = df_base
        if active_filters:
            for fc, fv in active_filters.items():
                if fc != col and fv and fc in df_col.columns:
                    df_col = _apply_filter_row(df_col, fc, fv)
        raw_vals = df_col[col].dropna().unique().tolist()
        result[col] = sorted(_raw_to_str_vals(raw_vals))[:100]
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
    df = _load_staging_df(
        staging_table_name,
        confirmed_relationships=recipe_config.get("confirmed_relationships") or None,
        upload_table_map=recipe_config.get("upload_table_map") or None,
    )
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
    granularity = (recipe_config.get("granularity") or "weekly").lower()

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
                # format="mixed" infers per-value format (ISO, DD-MM-YYYY, DD/MM/YYYY);
                # dayfirst=True breaks ties for ambiguous dates (e.g. "01-02-2024")
                # without triggering the pandas warning that fires when dayfirst=True
                # is combined with a detected %Y-%m-%d column.
                parsed = pd.to_datetime(
                    sample.astype(str), errors="coerce", format="mixed", dayfirst=True
                )
                parse_rate = float(parsed.notna().mean())

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
                        df[date_col].dropna(), errors="coerce", format="mixed", dayfirst=True
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
    # L6: Track raw column names separately to avoid splitting on " (" within column names
    details["high_cardinality_filters"] = [f for f in recipe_config.get("filters", [])
                                            if f not in missing and int(df[f].nunique()) > 100]

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
    # Extract PK/FK relationship context stored by session_generator.
    # When present, _load_staging_df will JOIN fact/dimension tables instead of
    # raw-concatenating them, giving formulas access to cross-file columns.
    _confirmed_rels = recipe_config.get("confirmed_relationships") or []
    _upload_table_map = recipe_config.get("upload_table_map") or {}

    # Enrich for BOTH active filter columns AND configured dimensions.
    # Dimension columns (e.g. location, department) may be absent from some fact
    # tables (e.g. QA file has no location col). Without enrichment those rows
    # produce NaN in dimension columns, breaking breakdown charts and filters.
    _dimensions = recipe_config.get("dimensions") or []
    _active_filter_cols = list(filters.keys()) if filters else []
    _enrich_cols = list(dict.fromkeys(_active_filter_cols + _dimensions)) or None

    df = _load_staging_df(
        staging_table_name,
        confirmed_relationships=_confirmed_rels or None,
        upload_table_map=_upload_table_map or None,
        filter_cols=_enrich_cols,
        date_column=recipe_config.get("date_column"),
    )
    if df.empty:
        return {"kpi_summaries": [], "time_series": [], "breakdown": []}

    # Apply row-level filters — handles Excel serial-date columns transparently
    if filters:
        for col, val in filters.items():
            if val:
                df = _apply_filter_row(df, col, val)
        if df.empty:
            return {"kpi_summaries": [], "time_series": [], "breakdown": [], "insights": []}

    # df_full: full filter-applied dataset used for KPI overall (card) values.
    # This matches what validate_formula computes so the recipe editor and
    # dashboard card always agree — even when some rows lack a parseable date.
    df_full = df.copy()

    date_col = recipe_config.get("date_column")
    granularity = (granularity_override or recipe_config.get("granularity", "weekly")).lower()
    kpis = recipe_config.get("kpis", [])
    dimensions = recipe_config.get("dimensions", [])

    # Parse date column for time-series — handles three cases per row:
    #   1. Numeric value in Excel serial range (e.g. 46110 → 2026-04-01)
    #   2. Datetime string / proper datetime (pd.to_datetime handles it)
    #   3. Anything else → NaT (dropped below — only affects time series, not card values)
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

    # Pre-compute once: df_reset and dimension candidates.
    # When the recipe has explicit user-selected dimensions (set on the Dimensions page),
    # use those exclusively so charts match what the user picked.
    # Fall back to scanning all non-numeric low-cardinality columns when no dims configured.
    from services.ai_interview import _is_bad_filter_col as _bad_col  # inline to avoid circular import
    df_reset = df.reset_index() if date_col else df

    _config_dims = [
        d for d in (recipe_config.get("dimensions") or [])
        if d in df_reset.columns
        and not pd.api.types.is_numeric_dtype(df_reset[d])
        and 2 <= df_reset[d].nunique() <= 50
    ]
    _breakdown_candidates = _config_dims if _config_dims else sorted(
        [
            c for c in df_reset.columns
            if not _bad_col(c)
            and not _is_time_derived_col(c)
            and not pd.api.types.is_numeric_dtype(df_reset[c])
            and 2 <= df_reset[c].nunique() <= 50
            and c != date_col
        ],
        key=lambda d: df_reset[d].nunique(),
    )

    for kpi in kpis:
        name = kpi.get("name", "")
        formula = kpi.get("formula", "")
        # ratio_of_sums: sum(numerator)/sum(denominator) per period — avoids per-row averaging bias
        is_ros = kpi.get("aggregation") == "ratio_of_sums" and "/" in formula

        if is_ros:
            # Overall card value: use df_full (no date filter) to match validate_formula
            ros_parts = [p.strip() for p in formula.split("/", 1)]
            num_full = _resolve_expr(ros_parts[0], df_full)
            den_full = _resolve_expr(ros_parts[1], df_full)
            if num_full is None or den_full is None or num_full.empty or den_full.empty:
                # H8: include format on early-exit paths for consistent output
                kpi_summaries.append({"name": name, "value": None, "formula": formula,
                                      "format": _infer_kpi_format(formula, kpi.get("format", ""))})
                continue
            den_total = float(den_full.sum())
            overall = float(num_full.sum()) / den_total if den_total != 0 else None
            # Time-series series still comes from date-indexed df
            num_s = _resolve_expr(ros_parts[0], df)
            den_s = _resolve_expr(ros_parts[1], df)
            series = (num_s / den_s.replace(0, pd.NA)) if (num_s is not None and den_s is not None) else None
            agg = "ratio_of_sums"
        else:
            # Overall card value: use df_full (no date filter) to match validate_formula
            series_full = _eval_formula(df_full, formula)
            if series_full.empty:
                kpi_summaries.append({"name": name, "value": None, "formula": formula})
                continue
            agg = _formula_agg(formula)
            if series_full.empty:
                # H8: include format on early-exit paths for consistent output
                kpi_summaries.append({"name": name, "value": None, "formula": formula,
                                      "format": _infer_kpi_format(formula, kpi.get("format", ""))})
                continue
            raw_val = series_full.mean() if agg in ("mean", "ratio") else series_full.sum()
            overall = None if pd.isna(raw_val) else float(raw_val)
            # Time-series series still comes from date-indexed df
            series = _eval_formula(df, formula)

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

        # Time series (resampled) — uses date-indexed df
        # H10: also skip if the entire series is NaN (e.g. all denominators were zero)
        if date_col and series is not None and not series.empty and not series.isna().all():
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

        # Breakdown: generate one chart entry per viable dimension.
        # Pre-compute the KPI series once, assign to a temp column, then use
        # vectorized groupby aggregation instead of per-group _eval_formula calls.
        # This avoids 1 Python-level _eval_formula call per group (8–50 groups per
        # dimension × N dimensions per KPI) and gives a 10–20× speedup on breakdown.
        _bkd_tmp = "_bkd_kpi_"
        if is_ros:
            _ros_fp = [p.strip() for p in formula.split("/", 1)]
            _bkd_num_col = "_bkd_num_"
            _bkd_den_col = "_bkd_den_"
            df_reset[_bkd_num_col] = pd.to_numeric(
                _resolve_expr(_ros_fp[0], df_reset), errors="coerce"
            )
            df_reset[_bkd_den_col] = pd.to_numeric(
                _resolve_expr(_ros_fp[1], df_reset), errors="coerce"
            )
        else:
            df_reset[_bkd_tmp] = pd.to_numeric(
                _eval_formula(df_reset, formula), errors="coerce"
            )

        # User-selected dims (_config_dims): iterate all of them — no break — so every
        # selected dimension gets its own breakdown chart for this KPI.
        # Fallback auto-dims: break after the first viable dim (legacy behaviour).
        for _dim in _breakdown_candidates:
            if is_ros:
                _g_num = df_reset.groupby(_dim)[_bkd_num_col].sum()
                _g_den = df_reset.groupby(_dim)[_bkd_den_col].sum()
                grouped = (_g_num / _g_den.replace(0, pd.NA)).dropna()
            elif agg in ("mean", "ratio"):
                grouped = df_reset.groupby(_dim)[_bkd_tmp].mean().dropna()
            else:
                grouped = df_reset.groupby(_dim)[_bkd_tmp].sum().dropna()

            if not grouped.empty:
                breakdown.append({
                    "kpi": name,
                    "dimension": _dim,
                    "data": [
                        {"label": str(k), "value": round(float(v), 4)}
                        for k, v in grouped.items()
                        if pd.notna(v)
                    ][:20],  # cap at 20 groups
                })
                if not _config_dims:
                    break  # fallback: stop after first viable dim per KPI

        # Clean up temp columns so subsequent KPIs start fresh.
        for _tc in [_bkd_tmp, "_bkd_num_", "_bkd_den_"]:
            if _tc in df_reset.columns:
                df_reset.drop(columns=[_tc], inplace=True)

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

        if abs(prev) < 1e-6:
            continue

        pct_change = (last - prev) / abs(prev) * 100
        overall_change = (last - first) / abs(first) * 100 if abs(first) >= 1e-6 else 0

        # H11: Use stored format rather than heuristic "/" check to avoid double-multiplying
        # data already stored as 0-100 percentages (e.g. a "percent_resolved" column).
        fmt_name = kpi.get("format") or _infer_kpi_format(formula)
        if fmt_name == "percentage":
            # Ratio formula results are 0-1; explicit percent columns are 0-100
            fmt = (lambda v: f"{v * 100:.1f}%") if abs(value) <= 1 else (lambda v: f"{v:.1f}%")
        elif fmt_name == "currency":
            fmt = lambda v: f"${v:,.2f}"
        elif fmt_name == "integer":
            fmt = lambda v: f"{int(v):,}"
        else:
            fmt = lambda v: f"{v:,.2f}"

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
