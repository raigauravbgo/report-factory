from pathlib import Path

import pandas as pd


def ingest(file_path: str, file_type: str = "unknown") -> dict:
    """Read a raw CSV or Excel file and return a DataFrame plus metadata."""
    path = Path(file_path)
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path, encoding_errors="replace")

    return {
        "dataframe": df,
        "row_count": len(df),
        "column_count": len(df.columns),
        "columns": list(df.columns),
        "sample": df.head(5).to_dict(orient="records"),
        "file_type": file_type,
        "file_name": path.name,
    }
