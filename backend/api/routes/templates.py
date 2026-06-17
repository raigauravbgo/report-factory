"""
Report Template endpoints.

POST /api/templates                   — save a recipe as a named template
GET  /api/templates                   — list all saved templates
POST /api/templates/match             — given uploaded file headers, return compatible templates (≥ 95% column overlap)
GET  /api/templates/{id}              — get a single template
DELETE /api/templates/{id}            — delete a template
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/templates", tags=["templates"])

_MATCH_THRESHOLD = 0.95  # minimum column overlap fraction to consider a file a match


def _column_overlap(uploaded_cols: list[str], template_cols: list[str]) -> float:
    """Fraction of template columns that are present in the uploaded file."""
    if not template_cols:
        return 0.0
    uploaded_set = {c.strip().lower() for c in uploaded_cols}
    template_set = {c.strip().lower() for c in template_cols}
    matched = len(template_set & uploaded_set)
    return matched / len(template_set)


def _match_files_to_slots(
    uploaded_files: list[dict],   # [{"filename": str, "columns": [str]}]
    fingerprints: list[dict],     # [{"slot": int, "columns": [str]}]
) -> tuple[bool, list[dict]]:
    """Try to assign each template slot to one uploaded file at ≥ 95% overlap.

    Returns (all_slots_matched, slot_assignments) where slot_assignments is
    [{"slot": int, "matched_file": filename, "overlap": float}].
    Each uploaded file can only fill one slot.
    """
    used: set[int] = set()
    assignments: list[dict] = []

    for fp in fingerprints:
        best_idx: int | None = None
        best_overlap = 0.0
        for i, uf in enumerate(uploaded_files):
            if i in used:
                continue
            overlap = _column_overlap(uf["columns"], fp["columns"])
            if overlap >= _MATCH_THRESHOLD and overlap > best_overlap:
                best_overlap = overlap
                best_idx = i
        if best_idx is None:
            return False, []
        used.add(best_idx)
        assignments.append({
            "slot": fp["slot"],
            "matched_file": uploaded_files[best_idx]["filename"],
            "overlap": round(best_overlap, 4),
        })

    return True, assignments


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def save_template(body: dict, db: Session = Depends(get_db)):
    """Save a dashboard recipe as a named reusable template.

    Required body fields:
      recipe_id : int   — the recipe to save as a template
      name      : str   — user-given template name (e.g. "QA Monthly Report")
    """
    from models.report_recipe import ReportRecipe
    from models.report_template import ReportTemplate
    from models.upload import Upload
    from models.staging_table import StagingTable

    recipe_id: int | None = body.get("recipe_id")
    name: str = (body.get("name") or "").strip()

    if not recipe_id:
        raise HTTPException(400, "recipe_id is required.")
    if not name:
        raise HTTPException(400, "name is required.")

    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, f"Recipe {recipe_id} not found.")

    cfg = recipe.config or {}
    dataset_id = recipe.dataset_id or cfg.get("dataset_id")

    # Build column fingerprints from staging tables for this dataset.
    # Each non-virtual upload becomes one slot.
    fingerprints: list[dict] = []
    if dataset_id:
        uploads = (
            db.query(Upload)
            .filter(
                Upload.dataset_id == dataset_id,
                Upload.filename != "__virtual_dimension__",
            )
            .all()
        )
        for slot_idx, upload in enumerate(uploads):
            st = db.query(StagingTable).filter(StagingTable.upload_id == upload.id).first()
            cols: list[str] = []
            if st and st.profile_data:
                cols = [c["name"] for c in st.profile_data.get("columns", [])]
            fingerprints.append({
                "slot": slot_idx,
                "filename_hint": upload.filename,
                "columns": cols,
            })

    template = ReportTemplate(
        name=name,
        config=cfg,
        file_fingerprints=fingerprints,
        source_recipe_id=recipe_id,
        source_dataset_id=dataset_id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    logger.info("TEMPLATE_SAVED id=%d name=%r recipe_id=%d slots=%d", template.id, name, recipe_id, len(fingerprints))

    return _serialise(template)


@router.get("")
def list_templates(db: Session = Depends(get_db)):
    """Return all saved templates ordered by most recently created."""
    from models.report_template import ReportTemplate
    templates = db.query(ReportTemplate).order_by(ReportTemplate.created_at.desc()).all()
    return [_serialise(t) for t in templates]


@router.post("/match")
def match_templates(body: dict, db: Session = Depends(get_db)):
    """Return templates compatible with the uploaded files at ≥ 95% column overlap.

    Body:
      uploaded_files: [{"filename": str, "columns": [str]}]

    Response:
      [{"template": {...}, "slot_assignments": [...], "is_match": true}]
      Only templates where ALL slots are matched are returned.
    """
    from models.report_template import ReportTemplate

    uploaded_files: list[dict] = body.get("uploaded_files") or []
    if not uploaded_files:
        raise HTTPException(400, "uploaded_files is required.")

    templates = db.query(ReportTemplate).order_by(ReportTemplate.created_at.desc()).all()
    results = []
    for t in templates:
        fp = t.file_fingerprints or []
        if not fp:
            continue
        matched, assignments = _match_files_to_slots(uploaded_files, fp)
        if matched:
            results.append({
                "template": _serialise(t),
                "slot_assignments": assignments,
            })

    logger.info(
        "TEMPLATE_MATCH uploaded=%d templates_checked=%d matches=%d",
        len(uploaded_files), len(templates), len(results),
    )
    return results


@router.get("/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    from models.report_template import ReportTemplate
    t = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "Template not found.")
    return _serialise(t)


@router.put("/{template_id}")
def update_template(template_id: int, body: dict, db: Session = Depends(get_db)):
    """Partially update a template's config (permanent override from Review page)."""
    from models.report_template import ReportTemplate

    t = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "Template not found.")

    if "config" in body:
        t.config = body["config"]
    if "name" in body:
        t.name = body["name"].strip() or t.name

    db.commit()
    db.refresh(t)
    logger.info("TEMPLATE_UPDATED id=%d", template_id)
    return _serialise(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    from models.report_template import ReportTemplate
    t = db.query(ReportTemplate).filter(ReportTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "Template not found.")
    db.delete(t)
    db.commit()


# ── Helper ────────────────────────────────────────────────────────────────────

def _serialise(t) -> dict:
    cfg = t.config or {}
    return {
        "id": t.id,
        "name": t.name,
        "kpi_names": [k.get("name", "") for k in cfg.get("kpis", [])],
        "kpi_count": len(cfg.get("kpis", [])),
        "date_column": cfg.get("date_column") or "",
        "granularity": cfg.get("granularity") or "weekly",
        "dimensions": cfg.get("dimensions") or [],
        "filters": cfg.get("filters") or [],
        "file_slots": [
            {"slot": fp["slot"], "filename_hint": fp.get("filename_hint", ""), "column_count": len(fp.get("columns", []))}
            for fp in (t.file_fingerprints or [])
        ],
        "source_recipe_id": t.source_recipe_id,
        "config": cfg,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
