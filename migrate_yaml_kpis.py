"""
One-time script: Convert all YAML KPI definitions to the unified JSON catalog format
and merge into backend/catalog/kpis.json.

Run from project root:
    python migrate_yaml_kpis.py

Then seed the SQLite database:
    cd backend && python seed_catalog.py
"""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).parent
YAML_DIR = ROOT / "backend" / "kpi_registry" / "definitions"
CATALOG_PATH = ROOT / "backend" / "catalog" / "kpis.json"

# Map YAML category names → JSON domain names
CATEGORY_TO_DOMAIN = {
    "collections": "collections",
    "revenue": "sales",
    "generic": "ops",
    "work_avoidance": "ops",
    "call_data": "cx",
    "call_center": "cx",
    "agent_summary": "cx",
    "agent_session": "cx",
    "agent_activity": "cx",
    "dialler": "cx",
    "retail_sales": "sales",
    "advanced_sales": "sales",
    "workforce": "workforce",
    "hr": "workforce",
}

# Map YAML unit strings → JSON format values
UNIT_TO_FORMAT = {
    "%": "percentage",
    "percent": "percentage",
    "percentage": "percentage",
    "$": "currency",
    "AUD": "currency",
    "CAD": "currency",
    "USD": "currency",
    "currency": "currency",
    "min": "duration",
    "minutes": "duration",
    "seconds": "duration",
    "duration": "duration",
    "count": "integer",
    "integer": "integer",
    "": "integer",
}


def yaml_kpi_to_json(kpi: dict) -> dict:
    """Convert a YAML KPI dict to the unified JSON catalog schema."""
    kpi_id = kpi["id"]
    category = kpi.get("category", "generic").lower()
    domain = CATEGORY_TO_DOMAIN.get(category, "ops")

    unit = str(kpi.get("unit", "")).strip()
    fmt = UNIT_TO_FORMAT.get(unit, "integer")

    required_cols = kpi.get("required_columns", [])

    return {
        "kpi_id": kpi_id,
        "display_name": kpi.get("name", kpi_id.replace("_", " ").title()),
        "description": kpi.get("description", ""),
        "numerator": "",
        "denominator": "_none_",
        "format": fmt,
        "domain": domain,
        "expected_range": None,
        "aliases": [],
        "source_fields": required_cols,
        "required_columns": required_cols,
        "formula": kpi.get("formula", ""),
        "chart_type": kpi.get("chart_type", "bar"),
        "unit": unit,
        "reviewed": True,
    }


def load_yaml_kpis() -> dict[str, dict]:
    kpis: dict[str, dict] = {}
    for yaml_file in sorted(YAML_DIR.glob("*.yaml")):
        with open(yaml_file, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        for kpi in data.get("kpis", []):
            converted = yaml_kpi_to_json(kpi)
            kpis[converted["kpi_id"]] = converted
    print(f"Loaded {len(kpis)} KPIs from YAML registry")
    return kpis


def load_existing_json() -> dict[str, dict]:
    if not CATALOG_PATH.exists():
        return {}
    with open(CATALOG_PATH, encoding="utf-8") as f:
        data = json.load(f)
    # Index by kpi_id
    existing = {k["kpi_id"]: k for k in data}
    print(f"Loaded {len(existing)} existing KPIs from catalog/kpis.json")
    return existing


def merge(yaml_kpis: dict[str, dict], existing: dict[str, dict]) -> list[dict]:
    """
    Merge YAML KPIs into the existing JSON catalog.
    Existing JSON entries take priority (richer metadata), but we add
    formula/chart_type/required_columns from YAML if missing.
    New YAML KPIs (not in existing) are appended.
    """
    merged: dict[str, dict] = dict(existing)

    added = 0
    updated = 0
    for kpi_id, yaml_entry in yaml_kpis.items():
        if kpi_id in merged:
            # Existing JSON entry: add formula/chart_type/required_columns if missing
            entry = merged[kpi_id]
            changed = False
            if not entry.get("formula") and yaml_entry.get("formula"):
                entry["formula"] = yaml_entry["formula"]
                changed = True
            if not entry.get("chart_type") and yaml_entry.get("chart_type"):
                entry["chart_type"] = yaml_entry["chart_type"]
                changed = True
            if not entry.get("required_columns") and yaml_entry.get("required_columns"):
                entry["required_columns"] = yaml_entry["required_columns"]
                changed = True
            if changed:
                updated += 1
        else:
            merged[kpi_id] = yaml_entry
            added += 1

    print(f"Merge result: {added} added, {updated} enriched, {len(merged)} total")
    return list(merged.values())


def main():
    yaml_kpis = load_yaml_kpis()
    existing = load_existing_json()
    merged = merge(yaml_kpis, existing)

    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"Written {len(merged)} KPIs to {CATALOG_PATH}")
    print("\nNext step: cd backend && python seed_catalog.py")


if __name__ == "__main__":
    main()
