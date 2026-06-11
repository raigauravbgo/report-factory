from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)


def build_virtual_dimension(
    staging_dfs: list[tuple[str, pd.DataFrame]],
    min_tables: int = 2,
) -> pd.DataFrame | None:
    """
    Build a virtual dimension table from non-numeric columns that appear
    in at least `min_tables` of the provided fact tables.

    The entity key (used for deduplication) is the shared non-numeric
    column with the highest cardinality — typically agent_email or agent_id.

    Returns None when no qualifying common columns are found.
    """
    if not staging_dfs:
        return None

    # Count how many tables each non-numeric column appears in
    col_table_count: dict[str, int] = {}
    for _table_name, df in staging_dfs:
        for col in df.columns:
            if not pd.api.types.is_numeric_dtype(df[col]):
                col_table_count[col] = col_table_count.get(col, 0) + 1

    common_cols = [c for c, cnt in col_table_count.items() if cnt >= min_tables]
    if not common_cols:
        return None

    # Stack rows from each table — only the qualifying columns
    parts: list[pd.DataFrame] = []
    for _table_name, df in staging_dfs:
        available = [c for c in common_cols if c in df.columns]
        if available:
            parts.append(df[available])

    if not parts:
        return None

    combined = pd.concat(parts, ignore_index=True)

    # Entity key = highest-cardinality common column (most likely the identifier).
    # Purely cardinality-based — no column name assumptions.
    cardinalities = {c: int(combined[c].nunique()) for c in common_cols if c in combined.columns}
    entity_key = max(cardinalities, key=lambda c: cardinalities[c])

    # Single-table stability filter: for single-table mode (min_tables=1) only
    # include columns that are STABLE per entity (same value for every row of
    # that entity). Evaluation-level columns like rubric_name or grade_type vary
    # per row and are excluded; true agent attributes like location or team are
    # the same for all evaluations of the same agent and are kept.
    if min_tables == 1:
        stable_cols = [entity_key]
        for col in common_cols:
            if col == entity_key or col not in combined.columns:
                continue
            max_nunique_per_entity = int(combined.groupby(entity_key)[col].nunique().max())
            if max_nunique_per_entity <= 1:
                stable_cols.append(col)
        combined = combined[stable_cols]

    result = combined.drop_duplicates(subset=[entity_key]).reset_index(drop=True)

    logger.info(
        "virtual_dimension: built from %d tables, %d columns, %d rows, key=%s",
        len(staging_dfs),
        len(result.columns),
        len(result),
        entity_key,
    )
    return result


def store_virtual_dimension(
    dataset_id: int,
    staging_dfs: list[tuple[str, pd.DataFrame]],
    db,
    engine,
    client_id: str,
) -> object | None:
    """
    Build the virtual dimension and persist it:
      1. Build the DataFrame via build_virtual_dimension()
      2. Write to a physical staging table
      3. Create a synthetic Upload + StagingTable ORM record
      4. Return the StagingTable, or None if nothing was built
    """
    from models.staging_table import StagingTable
    from models.upload import Upload
    from services.profiler import profile

    # Auto-detect: use min_tables=1 when only a single fact table is available
    # so a single-file dataset can still get a virtual dimension.
    effective_min_tables = 1 if len(staging_dfs) == 1 else 2
    vd_df = build_virtual_dimension(staging_dfs, min_tables=effective_min_tables)
    if vd_df is None:
        return None

    # Synthetic Upload record so the FK constraint on StagingTable is satisfied
    upload = Upload(
        client_id=client_id,
        dataset_id=dataset_id,
        s3_key="virtual",
        filename="__virtual_dimension__",
        status="profiled",
    )
    db.add(upload)
    # Commit so upload.id is assigned AND the session releases its write lock
    # before pandas opens a second connection for to_sql (required for SQLite).
    db.commit()

    table_name = f"staging_{upload.id}"

    # Write the physical staging table
    vd_df.to_sql(table_name, con=engine, index=False, if_exists="replace")

    # Profile the virtual dimension DataFrame
    prof = profile(vd_df, upload.id)
    prof_dict = prof.model_dump()
    prof_dict["table_type"] = "virtual_dimension"

    st = StagingTable(
        client_id=client_id,
        upload_id=upload.id,
        table_name=table_name,
        row_count=len(vd_df),
        column_count=len(vd_df.columns),
        duplicate_row_count=0,
        profile_data=prof_dict,
    )
    db.add(st)
    db.commit()

    logger.info(
        "virtual_dimension: stored as %s, upload_id=%d, rows=%d, cols=%d",
        table_name,
        upload.id,
        len(vd_df),
        len(vd_df.columns),
    )
    return st
