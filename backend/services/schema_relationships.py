from __future__ import annotations

import dataclasses
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from models.staging_table import StagingTable
from models.upload import Upload


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
    Three signals: column name fuzzy match, value set overlap, cardinality match.
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
    seen: set[tuple] = set()

    for i, fa in enumerate(file_profiles):
        for j, fb in enumerate(file_profiles):
            if j <= i:
                continue
            for ca in fa.columns:
                for cb in fb.columns:
                    key = (fa.filename, ca["name"], fb.filename, cb["name"])
                    if key in seen:
                        continue
                    seen.add(key)

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

    # Sort by confidence descending, cap at 20 suggestions
    return sorted(suggestions, key=lambda s: s.confidence, reverse=True)[:20]


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
