import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import create_kpi, get_kpi_by_id

VALID_FORMATS = ["percentage", "integer", "currency", "duration"]
VALID_DOMAINS = ["collections", "cx", "sales", "workforce", "ops"]


def _make_kpi_id(display_name: str) -> str:
    """'PTP Kept Rate' → 'ptp_kept_rate'"""
    slug = re.sub(r"[^a-z0-9]+", "_", display_name.lower()).strip("_")
    return slug


def run_define_new_kpi(
    display_name: str,
    numerator: str,
    denominator: str,
    format: str,
    domain: str,
    description: str = "",
    expected_min: float | None = None,
    expected_max: float | None = None,
    aliases: list[str] | None = None,
    source_fields: list[str] | None = None,
) -> dict:
    """
    Creates a new KPI definition in the catalog from user-provided information.
    Use this when the user requests a KPI that does not exist in the catalog.
    The KPI is saved with reviewed=false and will be formally reviewed by the central
    data team when the report reaches the review queue.

    Args:
        display_name: Human-readable name, e.g. "Average Handle Time".
        numerator: The column name or field that forms the numerator (what is being measured).
            Use "_none_" if this is a pure sum/count with no denominator.
        denominator: The column name or field that forms the denominator.
            Use "_none_" if this KPI is a raw total (sum or count, not a rate).
        format: One of percentage | integer | currency | duration.
        domain: One of collections | cx | sales | workforce | ops.
        description: Brief description of what the KPI measures.
        expected_min: Lower bound of expected values (e.g. 0 for a percentage).
        expected_max: Upper bound of expected values (e.g. 1 for a percentage).
        aliases: Other names this KPI is known by.
        source_fields: Column name variants to help auto-map future Excel uploads.

    Returns:
        The newly created KPI record, or an error dict if validation fails.
    """
    # Validate format and domain
    if format not in VALID_FORMATS:
        return {"error": f"Invalid format '{format}'. Choose from: {VALID_FORMATS}"}
    if domain not in VALID_DOMAINS:
        return {"error": f"Invalid domain '{domain}'. Choose from: {VALID_DOMAINS}"}

    # Generate kpi_id, handle collisions
    kpi_id = _make_kpi_id(display_name)
    if not kpi_id:
        return {"error": "Could not generate a valid kpi_id from the display name."}

    base_id = kpi_id
    counter = 2
    while get_kpi_by_id(kpi_id):
        kpi_id = f"{base_id}_{counter}"
        counter += 1

    # Build expected_range
    expected_range = None
    if expected_min is not None or expected_max is not None:
        expected_range = {}
        if expected_min is not None:
            expected_range["min"] = expected_min
        if expected_max is not None:
            expected_range["max"] = expected_max

    # Include numerator/denominator in source_fields so fuzzy mapper can use them
    sf = list(source_fields or [])
    for candidate in [numerator, denominator]:
        if candidate and candidate != "_none_" and candidate not in sf:
            sf.append(candidate)

    kpi = {
        "kpi_id": kpi_id,
        "display_name": display_name,
        "description": description,
        "numerator": numerator,
        "denominator": denominator if denominator else "_none_",
        "format": format,
        "domain": domain,
        "expected_range": expected_range,
        "aliases": aliases or [],
        "source_fields": sf,
        "reviewed": False,
    }

    created = create_kpi(kpi)

    return {
        "status": "kpi_defined",
        "kpi_id": kpi_id,
        "display_name": display_name,
        "reviewed": False,
        "message": (
            f"New KPI '{display_name}' added to the catalog as '{kpi_id}' (pending review). "
            "The central data team will formally review it when your report reaches the review queue."
        ),
        "kpi": created,
    }
