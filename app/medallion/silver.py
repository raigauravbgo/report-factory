import pandas as pd


def clean(df: pd.DataFrame, column_mapping: dict, registry=None) -> dict:
    """
    Rename columns per confirmed mapping, apply synonym normalization,
    drop ignored columns, deduplicate, and parse date columns.
    """
    # Step 1 — apply user-confirmed mapping
    rename_map = {
        orig: info["canonical_name"]
        for orig, info in column_mapping.items()
        if info.get("status") != "ignored" and info.get("canonical_name")
    }
    cleaned = df.rename(columns=rename_map)

    # Step 2 — drop ignored columns
    ignored = [
        orig
        for orig, info in column_mapping.items()
        if info.get("status") == "ignored" and orig in cleaned.columns
    ]
    cleaned = cleaned.drop(columns=ignored, errors="ignore")

    # Step 3 — synonym normalization safety net
    # Any remaining column whose lowercase form is a known synonym gets renamed
    # to its canonical form. This catches cases where the AI mapping was imprecise.
    if registry is not None:
        synonym_rename = registry.normalize_columns(list(cleaned.columns))
        if synonym_rename:
            cleaned = cleaned.rename(columns=synonym_rename)

    # Step 4 — deduplicate
    initial_rows = len(cleaned)
    cleaned = cleaned.drop_duplicates()

    # Step 5 — auto-parse date/timestamp columns
    for col in cleaned.columns:
        if any(term in col.lower() for term in ["date", "timestamp", "time", "_dt"]):
            try:
                cleaned[col] = pd.to_datetime(cleaned[col], errors="coerce")
            except Exception:
                pass

    return {
        "dataframe": cleaned,
        "rows_before": initial_rows,
        "rows_after": len(cleaned),
        "duplicates_removed": initial_rows - len(cleaned),
        "null_counts": cleaned.isnull().sum().to_dict(),
        "columns": list(cleaned.columns),
    }
