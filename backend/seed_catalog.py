"""
Seed the KPI catalog into SQLite.
Run once from the backend/ directory: python seed_catalog.py
Idempotent — safe to re-run; upserts catalog entries without touching user-created KPIs.
"""
import json
import sys
from pathlib import Path

# Allow running directly from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db.database import get_conn, init_db

CATALOG_PATH = Path(__file__).resolve().parent / "catalog" / "kpis.json"


def seed() -> None:
    print("Initialising schema...")
    init_db()

    catalog: list[dict] = json.loads(CATALOG_PATH.read_text())
    print(f"Seeding {len(catalog)} KPIs...")

    with get_conn() as conn:
        for kpi in catalog:
            conn.execute(
                """INSERT OR REPLACE INTO kpi_catalog
                   (kpi_id, display_name, description, numerator, denominator,
                    format, domain, expected_range, aliases, source_fields, reviewed,
                    aggregation)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    kpi["kpi_id"],
                    kpi.get("display_name", kpi["kpi_id"]),
                    kpi.get("description", ""),
                    kpi.get("numerator", ""),
                    kpi.get("denominator", "_none_"),
                    kpi.get("format", "decimal"),
                    kpi.get("domain", ""),
                    json.dumps(kpi.get("expected_range")) if kpi.get("expected_range") else None,
                    json.dumps(kpi.get("aliases", [])),
                    json.dumps(kpi.get("source_fields", [])),
                    1 if kpi.get("reviewed") else 0,
                    kpi.get("aggregation", ""),
                ),
            )

    print(f"Done. {len(catalog)} KPIs seeded into kpi_catalog.")


if __name__ == "__main__":
    seed()
