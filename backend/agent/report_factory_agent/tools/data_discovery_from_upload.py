"""
Flow 1 → Flow 2 bridge tool.

Discovers KPI-to-column mappings for a file already uploaded and profiled
via the /upload endpoint. Uses the staging table profile (no re-parsing needed)
and fuzzy-matches every column against the full BGO KPI catalog.

Works for any domain — collections, CX, workforce, sales, ops — because it
searches the entire 69-KPI catalog and returns ranked suggestions.
The agent presents these to the user as suggestions, not as final decisions.
"""
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from db.database import get_kpi_catalog


def _score(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _load_profile(upload_id: int) -> dict | None:
    """Load profile_data from staging_tables for the given upload_id."""
    from core.database import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT profile_data, row_count, table_name FROM staging_tables WHERE upload_id = :uid"),
            {"uid": upload_id},
        ).fetchone()
    if not row:
        return None
    raw = row[0]
    profile = json.loads(raw) if isinstance(raw, str) else raw
    return {"profile": profile, "row_count": row[1], "table_name": row[2]}


def run_data_discovery_from_upload(upload_id: int) -> dict:
    """
    Suggests KPI-to-column mappings for a file already uploaded via Flow 1.

    This tool bridges Flow 1 uploads into the ADK agent pipeline. It loads
    the profiled column data from the staging table and fuzzy-matches every
    column against the full BGO KPI catalog (collections, CX, workforce,
    sales, ops domains).

    Results are SUGGESTIONS only. Always present them to the user and ask
    for confirmation before proceeding to standardise.

    Args:
        upload_id: The integer upload ID returned when the file was uploaded.

    Returns:
        Dict with:
          - columns: list of all detected columns with type and sample values
          - suggested_mappings: top KPI match per column (confidence > 0.4)
          - column_mapping: KPI → best matching column (for confirmed KPIs)
          - needs_review: items with confidence < 0.7
          - summary: human-readable overview for the agent to present
    """
    data = _load_profile(upload_id)
    if not data:
        return {
            "error": (
                f"No profiled data found for upload_id={upload_id}. "
                "Make sure the file was uploaded and profiling completed successfully."
            )
        }

    profile = data["profile"]
    row_count = data["row_count"]
    columns = profile.get("columns", [])
    headers = [c["name"] for c in columns]

    if not headers:
        return {"error": "No columns found in the uploaded file profile."}

    catalog = get_kpi_catalog()

    # ── Per-column: find top KPI match ──────────────────────────────────────
    suggested_mappings: list[dict] = []
    for col in columns:
        best_kpi = None
        best_score = 0.0
        best_display = ""

        for kpi in catalog:
            candidates = (
                kpi.get("source_fields", [])
                + [kpi["numerator"], kpi.get("denominator", "")]
                + kpi.get("aliases", [])
                + [kpi["display_name"], kpi["kpi_id"]]
            )
            for cand in candidates:
                if not cand or cand == "_none_":
                    continue
                s = _score(col["name"], cand)
                if s > best_score:
                    best_score = s
                    best_kpi = kpi["kpi_id"]
                    best_display = kpi["display_name"]

        if best_score >= 0.4:
            suggested_mappings.append({
                "column": col["name"],
                "detected_type": col["detected_type"],
                "suggested_role": col["suggested_role"],
                "sample_values": col.get("sample_values", [])[:3],
                "best_kpi_match": best_kpi,
                "best_kpi_display": best_display,
                "confidence": round(best_score, 2),
                "needs_review": best_score < 0.7,
            })

    # ── Per-KPI (from catalog): find best column match ───────────────────────
    column_mapping: dict[str, dict] = {}
    for kpi in catalog:
        candidates = (
            kpi.get("source_fields", [])
            + [kpi["numerator"], kpi.get("denominator", "")]
            + kpi.get("aliases", [])
        )
        best_col = None
        best_score = 0.0
        for header in headers:
            for cand in candidates:
                if not cand or cand == "_none_":
                    continue
                s = _score(header, cand)
                if s > best_score:
                    best_score = s
                    best_col = header

        if best_score >= 0.5:
            column_mapping[kpi["kpi_id"]] = {
                "raw_column": best_col,
                "confidence": round(best_score, 2),
                "needs_review": best_score < 0.7,
                "domain": kpi["domain"],
                "display_name": kpi["display_name"],
            }

    # Sort suggested mappings: high confidence first
    suggested_mappings.sort(key=lambda x: -x["confidence"])
    needs_review = [m for m in suggested_mappings if m["needs_review"]]

    # ── Build human-readable summary for the agent to present ────────────────
    date_cols = [c for c in columns if c["suggested_role"] == "date"]
    dim_cols = [c for c in columns if c["suggested_role"] == "dimension"]
    measure_cols = [c for c in columns if c["suggested_role"] == "measure"]

    high_conf = [m for m in suggested_mappings if m["confidence"] >= 0.7]
    summary_lines = [
        f"File has {row_count:,} rows and {len(headers)} columns.",
        f"Auto-detected: {len(date_cols)} date column(s), {len(dim_cols)} dimension(s), {len(measure_cols)} measure(s).",
        f"Found {len(high_conf)} high-confidence KPI matches (≥70%) and {len(needs_review)} that need your confirmation.",
    ]

    if date_cols:
        summary_lines.append(f"Likely date column: {date_cols[0]['name']}")
    if dim_cols:
        summary_lines.append(f"Likely dimensions: {', '.join(c['name'] for c in dim_cols[:5])}")
    if high_conf:
        top = high_conf[:5]
        summary_lines.append(
            "Top KPI matches: "
            + "; ".join(f"{m['column']} → {m['best_kpi_display']} ({int(m['confidence']*100)}%)" for m in top)
        )

    return {
        "status": "discovery_complete",
        "source": "staging_profile",
        "upload_id": upload_id,
        "row_count": row_count,
        "total_columns": len(headers),
        "columns": [
            {
                "name": c["name"],
                "type": c["detected_type"],
                "role": c["suggested_role"],
                "sample": c.get("sample_values", [])[:2],
            }
            for c in columns
        ],
        "suggested_mappings": suggested_mappings[:20],
        "column_mapping": column_mapping,
        "needs_review_count": len(needs_review),
        "needs_review": needs_review,
        "summary": " ".join(summary_lines),
        "message": (
            f"Discovery complete. {summary_lines[2]} "
            "Present the suggested mappings to the user. "
            "For items needing review, ask the user to confirm the correct column. "
            "Do NOT proceed to standardise until the user has confirmed all mappings."
        ),
    }
