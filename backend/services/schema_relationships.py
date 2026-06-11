from __future__ import annotations

import dataclasses
import logging
from difflib import SequenceMatcher

import pandas as pd
from sqlalchemy.orm import Session

from models.staging_table import StagingTable
from models.upload import Upload

logger = logging.getLogger(__name__)

_OVERLAP_THRESHOLD = 0.65   # minimum fraction of left values present in right
_SAMPLE_ROWS      = 300     # rows sampled per staging table for overlap probing


@dataclasses.dataclass
class RelationshipSuggestion:
    file_a: str
    col_a: str
    file_b: str
    col_b: str
    confidence: float
    relationship_type: str  # "pk_fk" | "same_dimension" | "shared_key"


def infer(dataset_id: int, db: Session) -> list[RelationshipSuggestion]:
    """
    Detect likely relationships between columns across all uploads in a dataset.

    Pass 1 — name-based: column name fuzzy match + type/tag signals.
    Pass 2 — value-overlap: for column pairs not detected in pass 1, load a sample
              from each staging table and check whether values overlap sufficiently
              to imply a FK join (e.g. Roster.email ↔ QA.emp_ref with 100% overlap).
    """
    # H5: Single JOIN query replaces N+1 (one StagingTable query per upload)
    rows = (
        db.query(StagingTable, Upload)
        .join(Upload, StagingTable.upload_id == Upload.id)
        .filter(Upload.dataset_id == dataset_id)
        .all()
    )
    if len(rows) < 2:
        return []

    file_profiles: list[_FileInfo] = []
    for staging, upload in rows:
        if not staging.profile_data:
            continue
        file_profiles.append(_FileInfo(
            filename=upload.filename,
            upload_id=upload.id,
            columns=staging.profile_data.get("columns", []),
            staging_table=staging.table_name,
        ))

    suggestions: list[RelationshipSuggestion] = []
    # scored_pairs  : ALL pairs visited in pass 1 (prevents rescoring the same pair)
    # emitted_pairs : pairs that produced a suggestion (pass 2 skips these only)
    scored_pairs: set[tuple] = set()
    emitted_pairs: set[tuple] = set()

    # ── Pass 1: name-based scoring ────────────────────────────────────────────
    for i, fa in enumerate(file_profiles):
        for j, fb in enumerate(file_profiles):
            if j <= i:
                continue
            for ca in fa.columns:
                for cb in fb.columns:
                    key = (fa.filename, ca["name"], fb.filename, cb["name"])
                    if key in scored_pairs:
                        continue
                    scored_pairs.add(key)

                    score, rel_type = _score_pair(ca, cb)
                    if score >= 0.6:
                        suggestions.append(RelationshipSuggestion(
                            file_a=fa.filename,
                            col_a=ca["name"],
                            file_b=fb.filename,
                            col_b=cb["name"],
                            confidence=round(score, 2),
                            relationship_type=rel_type,
                        ))
                        emitted_pairs.add(key)
                        emitted_pairs.add((fb.filename, cb["name"], fa.filename, ca["name"]))

    # ── Pass 2: value-overlap for cross-name pairs missed by name matching ────
    overlap_suggestions = _probe_value_overlap(file_profiles, emitted_pairs, db)
    suggestions.extend(overlap_suggestions)

    # Sort by confidence descending, cap at 20 suggestions
    return sorted(suggestions, key=lambda s: s.confidence, reverse=True)[:20]


def _probe_value_overlap(
    file_profiles: "list[_FileInfo]",
    already_seen: "set[tuple]",
    db: Session,
) -> "list[RelationshipSuggestion]":
    """Second pass: load staging table samples and detect cross-name relationships.

    For each pair of files, load up to _SAMPLE_ROWS rows of each non-numeric
    column.  When the overlap fraction of left values appearing in right values
    meets _OVERLAP_THRESHOLD, add a pk_fk suggestion.

    Only column pairs not already emitted by the name-based pass are considered.
    Numeric columns are skipped — they are measures, not identifiers.

    Uses the engine bound to the session so that tests using a temporary SQLite
    database are probed correctly rather than the app's default engine.
    """
    try:
        _engine = db.get_bind()
    except Exception:
        from core.database import engine as _engine  # fallback for unbound sessions

    result: list[RelationshipSuggestion] = []

    # Load sample DataFrames lazily, once per staging table.
    sample_cache: dict[str, pd.DataFrame] = {}

    def _get_sample(tname: str) -> "pd.DataFrame | None":
        if tname in sample_cache:
            return sample_cache[tname]
        try:
            with _engine.connect() as conn:
                df = pd.read_sql_table(tname, con=conn).head(_SAMPLE_ROWS)
            sample_cache[tname] = df
            return df
        except Exception as exc:
            logger.debug("_probe_value_overlap: could not load %s: %s", tname, exc)
            sample_cache[tname] = None
            return None

    for i, fa in enumerate(file_profiles):
        for j, fb in enumerate(file_profiles):
            if j <= i:
                continue

            df_a = _get_sample(fa.staging_table)
            df_b = _get_sample(fb.staging_table)
            if df_a is None or df_b is None:
                continue

            for ca in fa.columns:
                col_a = ca["name"]
                if col_a not in df_a.columns:
                    continue
                if pd.api.types.is_numeric_dtype(df_a[col_a]):
                    continue
                vals_a = set(df_a[col_a].dropna().astype(str).unique())
                if not vals_a:
                    continue

                for cb in fb.columns:
                    col_b = cb["name"]
                    # Skip pairs already handled in pass 1 (both orderings)
                    if (fa.filename, col_a, fb.filename, col_b) in already_seen:
                        continue
                    if (fb.filename, col_b, fa.filename, col_a) in already_seen:
                        continue
                    if col_b not in df_b.columns:
                        continue
                    if pd.api.types.is_numeric_dtype(df_b[col_b]):
                        continue

                    vals_b = set(df_b[col_b].dropna().astype(str))
                    if not vals_b:
                        continue

                    overlap = len(vals_a & vals_b) / len(vals_a)
                    if overlap < _OVERLAP_THRESHOLD:
                        continue

                    # Mark as seen so we don't emit duplicates
                    already_seen.add((fa.filename, col_a, fb.filename, col_b))
                    already_seen.add((fb.filename, col_b, fa.filename, col_a))

                    confidence = round(min(overlap, 1.0) * 0.9, 2)
                    result.append(RelationshipSuggestion(
                        file_a=fa.filename,
                        col_a=col_a,
                        file_b=fb.filename,
                        col_b=col_b,
                        confidence=confidence,
                        relationship_type="pk_fk",
                    ))
                    logger.info(
                        "OVERLAP_REL %s.%s ↔ %s.%s overlap=%.2f confidence=%.2f",
                        fa.filename, col_a, fb.filename, col_b, overlap, confidence,
                    )

    return result


def _score_pair(col_a: dict, col_b: dict) -> tuple[float, str]:
    name_score = SequenceMatcher(None, col_a["name"].lower(), col_b["name"].lower()).ratio()

    # Require at least a moderate name match to avoid false positives
    if name_score < 0.6:
        return 0.0, "shared_key"

    same_type = col_a.get("detected_type") == col_b.get("detected_type")
    same_role = col_a.get("suggested_role") == col_b.get("suggested_role")
    same_tag = col_a.get("semantic_tag") == col_b.get("semantic_tag")

    # Determine relationship type
    tag_a = col_a.get("semantic_tag", "")
    tag_b = col_b.get("semantic_tag", "")

    if tag_a == "entity_key" and tag_b == "entity_key":
        rel_type = "pk_fk"
    elif same_role and same_tag:
        rel_type = "same_dimension"
    else:
        rel_type = "shared_key"

    # Cardinality signal: if one is grain candidate and the other is not → pk_fk
    grain_a = col_a.get("grain_candidate", False)
    grain_b = col_b.get("grain_candidate", False)
    if grain_a != grain_b:
        rel_type = "pk_fk"

    # Composite score: weight name match most
    score = name_score * 0.6
    if same_type:
        score += 0.2
    if same_tag:
        score += 0.2

    return score, rel_type


@dataclasses.dataclass
class _FileInfo:
    filename: str
    upload_id: int
    columns: list[dict]
    staging_table: str
