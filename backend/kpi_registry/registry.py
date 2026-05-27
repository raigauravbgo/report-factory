from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml


class KPIRegistry:
    def __init__(self, definitions_dir: Optional[str] = None):
        self._kpis: dict[str, dict] = {}
        self._synonyms: dict[str, str] = {}   # variant → canonical
        self._canonical_names: list[str] = []

        base = Path(definitions_dir) if definitions_dir else Path(__file__).parent
        self._load_all(base / "definitions")
        self._load_synonyms(base / "synonyms.yaml")

    # ── Loaders ──────────────────────────────────────────────────────────────

    def _load_all(self, directory: Path) -> None:
        for yaml_file in sorted(directory.glob("*.yaml")):
            with open(yaml_file, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            for kpi in data.get("kpis", []):
                self._kpis[kpi["id"]] = kpi

    def _load_synonyms(self, path: Path) -> None:
        if not path.exists():
            return
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        for canonical, variants in data.get("synonyms", {}).items():
            self._synonyms[canonical] = canonical   # canonical maps to itself
            for variant in (variants or []):
                self._synonyms[variant.lower()] = canonical

        # Build the sorted list of all canonical names (for schema inference prompt)
        all_required: set[str] = set()
        for kpi in self._kpis.values():
            all_required.update(kpi.get("required_columns", []))
        self._canonical_names = sorted(all_required)

    # ── Public API ───────────────────────────────────────────────────────────

    def get(self, kpi_id: str) -> Optional[dict]:
        return self._kpis.get(kpi_id)

    def all(self) -> list[dict]:
        return list(self._kpis.values())

    def get_all_canonical_names(self) -> list[str]:
        """All canonical column names referenced across every KPI definition."""
        return self._canonical_names

    def resolve(self, column_name: str) -> str:
        """Map a column name (or variant) to its canonical form. Returns input unchanged if unknown."""
        return self._synonyms.get(column_name.lower(), column_name)

    def normalize_columns(self, columns: list[str]) -> dict[str, str]:
        """
        Return a rename map {original → canonical} for any column whose
        lowercase form is a known synonym. Columns with no match are excluded.
        """
        rename: dict[str, str] = {}
        for col in columns:
            canonical = self._synonyms.get(col.lower())
            if canonical and canonical != col:
                rename[col] = canonical
        return rename

    def evaluate_feasibility(self, available_canonical_columns: list[str]) -> dict:
        """
        Return which KPIs can be computed given the available columns.
        A column satisfies a requirement if it matches directly OR via the synonym map.
        """
        # Expand the available set to include all synonyms resolved to canonical names
        expanded: set[str] = set()
        for col in available_canonical_columns:
            expanded.add(col)
            expanded.add(self.resolve(col))

        available, blocked = [], []
        for kpi in self._kpis.values():
            required = set(kpi.get("required_columns", []))
            if required.issubset(expanded):
                available.append(kpi["id"])
            else:
                blocked.append(
                    {
                        "id": kpi["id"],
                        "name": kpi["name"],
                        "missing_columns": sorted(required - expanded),
                    }
                )
        return {"available": available, "blocked": blocked}
