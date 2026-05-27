from fastapi import APIRouter
from kpi_registry.registry import KPIRegistry

router = APIRouter(prefix="/api/registry", tags=["registry"])

_registry: KPIRegistry | None = None


def _get_registry() -> KPIRegistry:
    global _registry
    if _registry is None:
        _registry = KPIRegistry()
    return _registry


@router.get("/columns")
def get_canonical_columns():
    """Return all canonical column names known to the KPI registry."""
    return {"columns": _get_registry().get_all_canonical_names()}


@router.get("/kpis")
def get_all_kpis():
    """Return all KPIs from the YAML registry (lightweight, no DB required)."""
    return {"kpis": _get_registry().all()}
