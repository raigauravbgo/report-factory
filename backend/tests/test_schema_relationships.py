"""
TDD tests for schema_relationships.infer() — value-overlap detection (Fix B).

These tests target the gap where infer() misses cross-name relationships because
its _score_pair() requires name similarity >= 0.6 and does no value-overlap check.

Example: Roster.email ↔ QA.agent_email — name score ~0.625, barely passes.
         Roster.email ↔ QA.emp_ref    — name score ~0.3, silently dropped.

The fix adds a second pass that loads staging table samples and probes overlap
using the same logic as compute._find_cross_name_join_key.

All tests marked with "FAILS currently" expect to fail until the fix is applied.
"""
from __future__ import annotations

import pytest
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_test_db(tmp_path):
    db_path = tmp_path / "test_rels.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    from core.database import Base
    import models.dataset
    import models.upload
    import models.staging_table
    import models.report_recipe
    import models.processed_table
    import models.kpi_definition
    import models.dashboard_config
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


def _seed(engine, db, dataset_id, uploads_data):
    """Seed dataset, uploads, staging_tables and physical staging tables.

    uploads_data: list of dicts:
        {
          "filename": str,
          "table_type": str,
          "df": pd.DataFrame,          # written as physical staging table
          "profile_cols": list[dict],  # profile_data columns
        }

    Returns list of (upload_id, staging_table_name) tuples.
    """
    from models.dataset import Dataset
    from models.upload import Upload
    from models.staging_table import StagingTable

    ds = Dataset(id=dataset_id, client_id="test_client", name="test_ds")
    db.add(ds)
    db.flush()

    result = []
    for i, ud in enumerate(uploads_data):
        uid = dataset_id * 100 + i
        u = Upload(
            id=uid,
            client_id="test_client",
            dataset_id=dataset_id,
            s3_key=f"test/{ud['filename']}",
            filename=ud["filename"],
            status="profiled",
        )
        db.add(u)
        db.flush()

        tname = f"staging_{ud['filename'].replace('.', '_')}_{uid}"
        # Commit before pandas opens a second connection — prevents SQLite write-lock.
        db.commit()
        ud["df"].to_sql(tname, con=engine, if_exists="replace", index=False)

        columns = []
        for col in ud.get("profile_cols", []):
            columns.append({
                "name": col["name"],
                "suggested_role": col.get("suggested_role", "dimension"),
                "semantic_tag": col.get("semantic_tag", "entity_key" if col.get("is_key") else "dimension"),
                "unique_count": col.get("unique_count", ud["df"][col["name"]].nunique() if col["name"] in ud["df"].columns else 10),
                "grain_candidate": col.get("grain_candidate", False),
                "detected_type": col.get("detected_type", "string"),
                "sample_values": ud["df"][col["name"]].dropna().astype(str).unique()[:5].tolist() if col["name"] in ud["df"].columns else [],
            })

        st = StagingTable(
            client_id="test_client",
            upload_id=uid,
            table_name=tname,
            row_count=len(ud["df"]),
            column_count=len(ud["df"].columns),
            duplicate_row_count=0,
            profile_data={"table_type": ud["table_type"], "columns": columns},
        )
        db.add(st)
        db.flush()
        result.append((uid, tname))

    db.commit()
    return result


# ── Test 1: same-name exact-match is still detected (regression guard) ──────

def test_infer_detects_same_name_relationship(tmp_path):
    """Baseline: two files sharing the same column name must produce a suggestion."""
    engine, Session = _make_test_db(tmp_path)
    db = Session()

    agents = [f"u{i}@x.com" for i in range(50)]
    _seed(engine, db, 1, [
        {
            "filename": "Roster.xlsx", "table_type": "dimension",
            "df": pd.DataFrame({"agent_email": agents, "location": ["Loc"] * 50}),
            "profile_cols": [
                {"name": "agent_email", "semantic_tag": "entity_key", "grain_candidate": True, "detected_type": "string"},
                {"name": "location",    "semantic_tag": "dimension",                           "detected_type": "string"},
            ],
        },
        {
            "filename": "QA.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"agent_email": agents, "rubric_score": range(50)}),
            "profile_cols": [
                {"name": "agent_email", "semantic_tag": "entity_key", "grain_candidate": False, "detected_type": "string"},
                {"name": "rubric_score","semantic_tag": "metric",                               "detected_type": "float"},
            ],
        },
    ])

    from services.schema_relationships import infer
    suggestions = infer(1, db)

    assert any(
        s.col_a == "agent_email" and s.col_b == "agent_email"
        for s in suggestions
    ), "Same-name agent_email relationship must be detected"


# ── Test 2: cross-name low-score pair detected via value overlap ─────────────

def test_infer_detects_cross_name_relationship_via_value_overlap(tmp_path):
    """
    Roster has column 'email'; QA has column 'emp_ref'.
    Name similarity(email, emp_ref) ≈ 0.4 — below the current 0.6 hard cutoff.
    Both columns contain the SAME 50 email addresses.

    CURRENT BUG: infer() silently drops this pair because _score_pair() returns
    0.0 when name_score < 0.6 with no value-overlap fallback.

    After Fix B, infer() must detect this as a pk_fk relationship with
    high confidence (value overlap ≥ 0.65).
    """
    engine, Session = _make_test_db(tmp_path)
    db = Session()

    emails = [f"worker{i}@corp.com" for i in range(50)]
    _seed(engine, db, 2, [
        {
            "filename": "Roster.xlsx", "table_type": "dimension",
            "df": pd.DataFrame({"email": emails, "department": ["Dept"] * 50}),
            "profile_cols": [
                {"name": "email",      "semantic_tag": "entity_key", "grain_candidate": True,  "detected_type": "string"},
                {"name": "department", "semantic_tag": "dimension",                             "detected_type": "string"},
            ],
        },
        {
            "filename": "QA.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"emp_ref": emails, "score": [float(i) for i in range(50)]}),
            "profile_cols": [
                {"name": "emp_ref", "semantic_tag": "entity_key", "grain_candidate": False, "detected_type": "string"},
                {"name": "score",   "semantic_tag": "metric",                               "detected_type": "float"},
            ],
        },
    ])

    from services.schema_relationships import infer
    suggestions = infer(2, db)

    cross_name = [
        s for s in suggestions
        if {s.col_a, s.col_b} == {"email", "emp_ref"}
    ]
    assert cross_name, (
        "infer() must detect email↔emp_ref as a relationship via value overlap. "
        "FAILS currently because name_score('email','emp_ref') < 0.6 and there is "
        "no value-overlap fallback."
    )
    assert cross_name[0].relationship_type == "pk_fk", (
        "Cross-name join detected via value overlap must be classified as pk_fk"
    )
    assert cross_name[0].confidence >= 0.65, (
        f"Confidence should be ≥ 0.65 for 100% value overlap, got {cross_name[0].confidence}"
    )


# ── Test 3: no false positive when overlap is low ───────────────────────────

def test_infer_no_false_positive_when_overlap_below_threshold(tmp_path):
    """
    Columns with similar names but NO value overlap must NOT produce a relationship.
    e.g., both files have a 'region' column but the values are entirely different sets.
    """
    engine, Session = _make_test_db(tmp_path)
    db = Session()

    _seed(engine, db, 3, [
        {
            "filename": "A.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"region": [f"R{i}" for i in range(10)], "val": range(10)}),
            "profile_cols": [
                {"name": "region", "semantic_tag": "dimension", "detected_type": "string"},
                {"name": "val",    "semantic_tag": "metric",    "detected_type": "int"},
            ],
        },
        {
            "filename": "B.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"emp_code": [f"E{i}" for i in range(10)], "metric": range(10)}),
            "profile_cols": [
                {"name": "emp_code", "semantic_tag": "dimension", "detected_type": "string"},
                {"name": "metric",   "semantic_tag": "metric",    "detected_type": "int"},
            ],
        },
    ])

    from services.schema_relationships import infer
    suggestions = infer(3, db)

    # No relationship should be suggested — the only columns are region/emp_code
    # which share no values, and val/metric which are numeric
    false_positives = [
        s for s in suggestions
        if {s.col_a, s.col_b} == {"region", "emp_code"}
    ]
    assert not false_positives, (
        f"region↔emp_code have no value overlap and should not be suggested, "
        f"but got: {false_positives}"
    )


# ── Test 4: cross-name detection works across 3 files ──────────────────────

def test_infer_cross_name_detection_with_three_files(tmp_path):
    """
    3 files: Roster(email), QA(emp_ref), CSAT(staff_id) — all contain the same
    100 email addresses under different column names.

    After Fix B, infer() must find both cross-name pairs:
      Roster.email ↔ QA.emp_ref
      Roster.email ↔ CSAT.staff_id
    """
    engine, Session = _make_test_db(tmp_path)
    db = Session()

    emails = [f"agent{i}@co.com" for i in range(100)]
    _seed(engine, db, 4, [
        {
            "filename": "Roster.xlsx", "table_type": "dimension",
            "df": pd.DataFrame({"email": emails, "location": ["L"] * 100}),
            "profile_cols": [
                {"name": "email",    "semantic_tag": "entity_key", "grain_candidate": True,  "detected_type": "string"},
                {"name": "location", "semantic_tag": "dimension",                             "detected_type": "string"},
            ],
        },
        {
            "filename": "QA.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"emp_ref": emails, "rubric_score": [1.0] * 100}),
            "profile_cols": [
                {"name": "emp_ref",     "semantic_tag": "entity_key", "grain_candidate": False, "detected_type": "string"},
                {"name": "rubric_score","semantic_tag": "metric",                               "detected_type": "float"},
            ],
        },
        {
            "filename": "CSAT.xlsx", "table_type": "fact",
            "df": pd.DataFrame({"staff_id": emails, "csat_score": [4.0] * 100}),
            "profile_cols": [
                {"name": "staff_id",  "semantic_tag": "entity_key", "grain_candidate": False, "detected_type": "string"},
                {"name": "csat_score","semantic_tag": "metric",                               "detected_type": "float"},
            ],
        },
    ])

    from services.schema_relationships import infer
    suggestions = infer(4, db)

    pairs = [({s.col_a, s.col_b}, s.file_a, s.file_b) for s in suggestions]

    roster_qa = any(
        {"email", "emp_ref"} == p and {"Roster.xlsx", "QA.xlsx"} == {fa, fb}
        for p, fa, fb in pairs
    )
    roster_csat = any(
        {"email", "staff_id"} == p and {"Roster.xlsx", "CSAT.xlsx"} == {fa, fb}
        for p, fa, fb in pairs
    )

    assert roster_qa, (
        "infer() must detect Roster.email ↔ QA.emp_ref via value overlap. FAILS currently."
    )
    assert roster_csat, (
        "infer() must detect Roster.email ↔ CSAT.staff_id via value overlap. FAILS currently."
    )
