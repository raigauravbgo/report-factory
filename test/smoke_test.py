"""Quick smoke test for dashboard/4/data endpoint."""
import sys
import os

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))
os.chdir(os.path.abspath(BACKEND_DIR))

import traceback
from core.database import SessionLocal
from models.report_recipe import ReportRecipe
from schemas.interview import RecipeConfig
from api.routes.dashboard import _load_fact_with_dim, _eval_kpi, _formula_needs_col
from models.column_schema import ColumnSchema
from models.data_model import DataModel

recipe_id = 4

db = SessionLocal()
try:
    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        print(f"Recipe {recipe_id} not found")
        sys.exit(1)

    config = RecipeConfig(**recipe.config)
    print(f"Recipe {recipe_id} config:")
    print(f"  upload_id={config.upload_id}")
    print(f"  dataset_id={config.dataset_id}")
    print(f"  upload_ids={config.upload_ids}")
    print(f"  KPIs:")
    for k in config.kpis:
        print(f"    - {k.name}: formula={k.formula}, upload_id={k.upload_id}")

    # Find dim uids
    dm = db.query(DataModel).filter(DataModel.dataset_id == config.dataset_id).first()
    dim_uids = set()
    if dm and dm.tables:
        for t in dm.tables:
            role = t.get("confirmed_role") or t.get("role")
            if role == "dimension":
                dim_uids.add(t["upload_id"])
    print(f"\n  dim_uids={dim_uids}")

    all_upload_ids = list(config.upload_ids) if config.upload_ids else [config.upload_id]
    fact_upload_ids = [u for u in all_upload_ids if u not in dim_uids]
    print(f"  fact_upload_ids={fact_upload_ids}")

    # Resolve KPI upload IDs
    print("\n  KPI upload resolution:")
    for kpi in config.kpis:
        if kpi.upload_id is not None and kpi.upload_id not in dim_uids:
            print(f"    {kpi.name}: explicitly upload_id={kpi.upload_id}")
        else:
            needed = _formula_needs_col(kpi.formula)
            resolved_uid = config.upload_id
            if needed:
                match = (
                    db.query(ColumnSchema.upload_id)
                    .filter(
                        ColumnSchema.column_name == needed,
                        ColumnSchema.upload_id.in_(fact_upload_ids),
                    )
                    .first()
                )
                if match:
                    resolved_uid = match[0]
            print(f"    {kpi.name}: needed_col={needed}, resolved to upload_id={resolved_uid}")

    # Try loading each fact with dim
    print("\n  Loading fact DFs:")
    import pandas as pd
    engine = db.get_bind()
    for uid in fact_upload_ids:
        try:
            df = _load_fact_with_dim(uid, config, db, engine, active_filters={})
            print(f"    upload {uid}: {len(df)} rows x {len(df.columns)} cols")
            print(f"      columns sample: {list(df.columns[:10])}")
            if "department" in df.columns:
                non_null = df["department"].notna().sum()
                print(f"      department: {non_null}/{len(df)} non-null")
            if "__period__" in df.columns:
                print(f"      __period__ range: {df['__period__'].min()} to {df['__period__'].max()}")
            else:
                print(f"      __period__: NOT SET")
        except Exception as e:
            print(f"    upload {uid}: ERROR - {e}")
            traceback.print_exc()

    print("\nSmoke test complete.")
finally:
    db.close()
