"""Export the three fact+dim joined DataFrames to CSV for manual verification."""
import sys, os

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))
os.chdir(os.path.abspath(BACKEND_DIR))

import pandas as pd
from core.database import SessionLocal, engine
from models.data_model import DataModel
from models.column_schema import ColumnSchema
from sqlalchemy import inspect as sa_inspect

DATASET_ID = 2
RECIPE_ID  = 4

# Fact → label mapping (upload_id → name)
FACT_LABELS = {5: "adherence", 6: "csat", 7: "qa"}

db = SessionLocal()
inspect = sa_inspect(engine)

dm = db.query(DataModel).filter(DataModel.dataset_id == DATASET_ID).first()

dim_uids = set()
if dm and dm.tables:
    for t in dm.tables:
        role = t.get("confirmed_role") or t.get("role")
        if role == "dimension":
            dim_uids.add(t["upload_id"])

print(f"Dimension upload_ids: {dim_uids}")
print(f"FK relationships:")
for fk in (dm.foreign_keys or []):
    print(f"  upload_{fk['from_upload_id']}.{fk['from_col']} -> upload_{fk['to_upload_id']}.{fk['to_col']}  "
          f"confirmed={fk.get('confirmed')}  integrity={fk.get('integrity_pct')}%  join_type={fk.get('join_type')}")

for fact_uid, label in FACT_LABELS.items():
    print(f"\n{'='*60}")
    print(f"Processing staging_{fact_uid} ({label})...")

    fact_table = f"staging_{fact_uid}"
    if not inspect.has_table(fact_table):
        print(f"  Table {fact_table} not found, skipping.")
        continue

    with engine.connect() as conn:
        fact_df = pd.read_sql_table(fact_table, conn)
    print(f"  Fact rows: {len(fact_df):,}  cols: {len(fact_df.columns)}")

    # Find FK to dim
    dim_uid = fact_join_col = dim_join_col = None
    if dm and dm.foreign_keys:
        for fk in dm.foreign_keys:
            if not fk.get("confirmed", True):
                continue
            fu, tu = fk["from_upload_id"], fk["to_upload_id"]
            if fu == fact_uid and tu in dim_uids:
                dim_uid, fact_join_col, dim_join_col = tu, fk["from_col"], fk["to_col"]
                break
            elif tu == fact_uid and fu in dim_uids:
                dim_uid, fact_join_col, dim_join_col = fu, fk["to_col"], fk["from_col"]
                break

    if dim_uid is None:
        print("  No FK to dimension found — exporting fact table as-is.")
        joined = fact_df
    else:
        dim_table = f"staging_{dim_uid}"
        with engine.connect() as conn:
            dim_df = pd.read_sql_table(dim_table, conn)
        print(f"  Dim table: staging_{dim_uid}  rows: {len(dim_df):,}  join: {fact_join_col} → {dim_join_col}")

        # Strip dim columns from fact (roster is authoritative)
        dim_only_cols = [c for c in dim_df.columns if c != dim_join_col]
        dropped = [c for c in dim_only_cols if c in fact_df.columns]
        if dropped:
            print(f"  Dropping from fact (overridden by roster): {dropped}")
        fact_df = fact_df.drop(columns=dropped, errors="ignore")

        joined = fact_df.merge(dim_df, left_on=fact_join_col, right_on=dim_join_col, how="left")
        matched = joined[dim_join_col].notna().sum()
        print(f"  Joined rows: {len(joined):,}  matched to roster: {matched:,}  unmatched (NaN dim): {len(joined)-matched:,}")

    # Show KPI column stats for verification
    kpi_cols = {
        "adherence": ["min_in_adherence", "min_out_adherence"],
        "csat":      ["avg_csat_rating"],
        "qa":        ["rubric_score"],
    }
    for col in kpi_cols.get(label, []):
        if col in joined.columns:
            s = pd.to_numeric(joined[col], errors="coerce")
            valid = s.notna().sum()
            print(f"  {col}: mean={s.mean():.4f}  count={valid:,}  nulls={s.isna().sum():,}")

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"joined_{label}_fact_with_roster.csv")
    joined.to_csv(out_path, index=False, encoding="utf-8-sig")
    print(f"  Saved → {out_path}  ({len(joined):,} rows × {len(joined.columns)} cols)")

db.close()
print("\nDone.")
