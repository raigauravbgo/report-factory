"""Dimension suggestion service.

Returns only columns from confirmed dimension tables. Optionally uses AI
to annotate each column with a friendly label and recommendation flag.
"""
import json
import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def suggest(dataset_id: int, db: "Session", use_ai: bool = True) -> list[dict]:
    """Return dimension columns from dimension tables only."""
    from models.column_schema import ColumnSchema
    from models.data_model import DataModel
    from models.upload import Upload

    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    if not dm or not dm.tables:
        return []

    # Identify dimension table upload IDs
    dim_upload_ids: set[int] = set()
    pk_cols: dict[int, set[str]] = {}  # upload_id → pk column names
    for t in dm.tables:
        effective_role = t.get("confirmed_role") or t.get("role")
        if effective_role == "dimension":
            uid = t["upload_id"]
            dim_upload_ids.add(uid)
            pk_list = (dm.primary_keys or {}).get(str(uid), [])
            pk_cols[uid] = set(pk_list)

    if not dim_upload_ids:
        return []

    # Load column schemas for dimension tables
    cols = (
        db.query(ColumnSchema)
        .filter(ColumnSchema.upload_id.in_(dim_upload_ids))
        .all()
    )

    # Get filenames
    upload_names: dict[int, str] = {
        u.id: u.filename
        for u in db.query(Upload).filter(Upload.id.in_(dim_upload_ids)).all()
    }

    # Filter: dimension role only, skip PK columns
    dim_cols = []
    for c in cols:
        if c.effective_role != "dimension":
            continue
        if c.column_name in pk_cols.get(c.upload_id, set()):
            continue
        dim_cols.append(c)

    # Build base suggestion list
    suggestions = [
        {
            "column_name": c.column_name,
            "upload_id": c.upload_id,
            "table_name": upload_names.get(c.upload_id, f"upload_{c.upload_id}"),
            "display_label": _make_label(c.column_name),
            "is_recommended": c.effective_is_filter or c.unique_count <= 30,
            "reasoning": "From dimension table; suitable for grouping.",
        }
        for c in dim_cols
    ]

    # AI annotation pass
    if use_ai and suggestions:
        try:
            suggestions = _ai_annotate(suggestions)
        except Exception as exc:
            logger.warning("AI dimension annotation failed (%s) — using defaults.", exc)

    # Sort: recommended first, then alphabetically
    suggestions.sort(key=lambda x: (not x["is_recommended"], x["column_name"]))
    return suggestions


def _make_label(col_name: str) -> str:
    return re.sub(r"[_\-]+", " ", col_name).title()


def _ai_annotate(suggestions: list[dict]) -> list[dict]:
    from services.ai_client import chat_complete

    system = "You are a BI analyst. Annotate dimension columns for a dashboard. Output ONLY valid JSON."
    compact = [{"name": s["column_name"], "table": s["table_name"]} for s in suggestions]
    user_msg = (
        f"Dimension columns available for dashboard grouping:\n{json.dumps(compact, indent=2)}\n\n"
        "For each column, provide:\n"
        "- display_label: user-friendly label\n"
        "- is_recommended: true if this makes a valuable dashboard dimension\n"
        "- reasoning: one sentence\n\n"
        "Return JSON:\n"
        '{"columns": [{"name": "...", "display_label": "...", "is_recommended": true, "reasoning": "..."}]}'
    )

    raw = chat_complete(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        temperature=0.1,
        json_mode=True,
    )
    data = json.loads(raw)
    ai_map = {a["name"]: a for a in data.get("columns", [])}

    result = []
    for s in suggestions:
        ai = ai_map.get(s["column_name"])
        if ai:
            result.append(
                {
                    **s,
                    "display_label": ai.get("display_label", s["display_label"]),
                    "is_recommended": ai.get("is_recommended", s["is_recommended"]),
                    "reasoning": ai.get("reasoning", s["reasoning"]),
                }
            )
        else:
            result.append(s)
    return result
