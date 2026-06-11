"""
TDD tests for GET /session/{dataset_id}/dimensions — star-schema branch logic.

Verifies the four-branch priority in get_dimensions():
  Branch 1: virtual_dimension tables present → use their columns only
  Branch 2: dimension-typed tables present → use their columns only
  Branch 3: no dim tables → shared columns (present in >= 2 fact tables)
  Branch 4: fallback → all dimension-role columns
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_test_db(tmp_path):
    db_path = tmp_path / "test_dims.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    from core.database import Base
    import models.dataset        # noqa: F401
    import models.upload         # noqa: F401
    import models.staging_table  # noqa: F401
    import models.report_recipe  # noqa: F401
    import models.processed_table  # noqa: F401
    import models.kpi_definition   # noqa: F401
    import models.dashboard_config  # noqa: F401
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_dataset(db, dataset_id=1):
    from models.dataset import Dataset
    ds = Dataset(id=dataset_id, client_id="client", name="test")
    db.add(ds)
    db.flush()
    return ds


def _seed_upload(db, upload_id, dataset_id, filename="file.xlsx"):
    from models.upload import Upload
    u = Upload(
        id=upload_id,
        client_id="client",
        dataset_id=dataset_id,
        s3_key=f"test/{filename}",
        filename=filename,
        status="profiled",
    )
    db.add(u)
    db.flush()
    return u


def _seed_staging(db, upload_id, table_type, dim_cols):
    """Seed a StagingTable with explicit profile_data (no physical table needed).

    dim_cols: list of dicts with keys: name, semantic_tag (opt), unique_count (opt),
              sample_values (opt). Each column gets suggested_role='dimension'.
    Extra non-dim cols can be included via dim_cols by setting suggested_role override.
    """
    from models.staging_table import StagingTable
    columns = []
    for c in dim_cols:
        columns.append({
            "name": c["name"],
            "suggested_role": c.get("suggested_role", "dimension"),
            "semantic_tag": c.get("semantic_tag", "dimension"),
            "unique_count": c.get("unique_count", 10),
            "sample_values": c.get("sample_values", ["a", "b"]),
        })
    st = StagingTable(
        client_id="client",
        upload_id=upload_id,
        table_name=f"staging_{upload_id}",
        row_count=50,
        column_count=len(columns),
        duplicate_row_count=0,
        profile_data={"table_type": table_type, "columns": columns},
    )
    db.add(st)
    db.flush()
    return st


def _call(db, dataset_id):
    from api.routes.session import get_dimensions
    return get_dimensions(dataset_id=dataset_id, db=db)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_branch1_virtual_dimension(tmp_path):
    """Branch 1: virtual_dimension table present → only its columns returned.

    QA rubric cols must NOT appear in the result.
    """
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 1)
    _seed_upload(db, 101, 1, "Adherence.xlsx")
    _seed_upload(db, 102, 1, "QA.xlsx")
    _seed_upload(db, 103, 1, "__virtual_dimension__")

    _seed_staging(db, 101, "fact", [
        {"name": "location", "unique_count": 4},
        {"name": "department", "unique_count": 8},
    ])
    _seed_staging(db, 102, "fact", [
        {"name": "location", "unique_count": 4},
        {"name": "rubric_name", "unique_count": 15},
    ])
    _seed_staging(db, 103, "virtual_dimension", [
        {"name": "location", "unique_count": 4},
        {"name": "department", "unique_count": 8},
    ])
    db.commit()

    result = _call(db, 1)
    names = [d.name for d in result]

    assert "location" in names
    assert "department" in names
    assert "rubric_name" not in names, "rubric_name should not appear — it's not in the virtual dimension"


def test_branch2_real_dimension_table(tmp_path):
    """Branch 2: dimension table present → only its columns returned.

    Fact-only col (rubric_name from QA) must NOT appear.
    """
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 2)
    _seed_upload(db, 201, 2, "Roster.xlsx")
    _seed_upload(db, 202, 2, "QA.xlsx")
    _seed_upload(db, 203, 2, "CSAT.xlsx")

    # Roster is the dimension table
    _seed_staging(db, 201, "dimension", [
        {"name": "location", "unique_count": 4},
        {"name": "department", "unique_count": 8},
        {"name": "supervisor", "unique_count": 12},
    ])
    # Fact tables — rubric_name only in QA
    _seed_staging(db, 202, "fact", [
        {"name": "location", "unique_count": 4},
        {"name": "rubric_name", "unique_count": 15},
    ])
    _seed_staging(db, 203, "fact", [
        {"name": "location", "unique_count": 4},
        {"name": "survey_channel", "unique_count": 3},
    ])
    db.commit()

    result = _call(db, 2)
    names = [d.name for d in result]

    assert "location" in names
    assert "department" in names
    assert "supervisor" in names
    assert "rubric_name" not in names, "rubric_name is a fact-table-only column, not from dimension table"
    assert "survey_channel" not in names


def test_branch3_shared_columns_only(tmp_path):
    """Branch 3: no dimension tables → only columns present in >= 2 tables.

    rubric_name appears in 1 table only → excluded.
    location appears in 2 tables → included.
    """
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 3)
    _seed_upload(db, 301, 3, "Adherence.xlsx")
    _seed_upload(db, 302, 3, "CSAT.xlsx")
    _seed_upload(db, 303, 3, "QA.xlsx")

    _seed_staging(db, 301, "unknown", [
        {"name": "location", "unique_count": 4},
        {"name": "department", "unique_count": 8},
    ])
    _seed_staging(db, 302, "unknown", [
        {"name": "location", "unique_count": 4},
        {"name": "department", "unique_count": 8},
    ])
    _seed_staging(db, 303, "unknown", [
        {"name": "rubric_name", "unique_count": 15},  # only in QA
    ])
    db.commit()

    result = _call(db, 3)
    names = [d.name for d in result]

    assert "location" in names
    assert "department" in names
    assert "rubric_name" not in names, "rubric_name is in only 1 table, should be excluded"


def test_branch4_fallback_single_file(tmp_path):
    """Branch 4: single file → all dimension-role columns returned."""
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 4)
    _seed_upload(db, 401, 4, "Report.xlsx")

    _seed_staging(db, 401, "unknown", [
        {"name": "region", "unique_count": 5},
        {"name": "team", "unique_count": 10},
        {"name": "status", "unique_count": 3},
    ])
    db.commit()

    result = _call(db, 4)
    names = [d.name for d in result]

    assert "region" in names
    assert "team" in names
    assert "status" in names
    assert len(result) == 3


def test_table_count_reflects_all_tables(tmp_path):
    """table_count for a column from Branch 1 must count all tables that have it.

    location is in virtual_dimension + 2 fact tables → table_count == 3.
    """
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 5)
    _seed_upload(db, 501, 5, "Adherence.xlsx")
    _seed_upload(db, 502, 5, "CSAT.xlsx")
    _seed_upload(db, 503, 5, "__virtual_dimension__")

    _seed_staging(db, 501, "fact", [{"name": "location", "unique_count": 4}])
    _seed_staging(db, 502, "fact", [{"name": "location", "unique_count": 4}])
    _seed_staging(db, 503, "virtual_dimension", [{"name": "location", "unique_count": 4}])
    db.commit()

    result = _call(db, 5)
    loc = next((d for d in result if d.name == "location"), None)

    assert loc is not None
    assert loc.table_count == 3, f"Expected table_count=3, got {loc.table_count}"


def test_excluded_semantic_tags(tmp_path):
    """entity_key, time_key, financial_metric tags must be excluded from all branches."""
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 6)
    _seed_upload(db, 601, 6, "Roster.xlsx")

    _seed_staging(db, 601, "dimension", [
        {"name": "agent_email", "semantic_tag": "entity_key", "unique_count": 100},
        {"name": "hire_date",   "semantic_tag": "time_key",   "unique_count": 50},
        {"name": "base_salary", "semantic_tag": "financial_metric", "unique_count": 20},
        {"name": "location",    "semantic_tag": "dimension",  "unique_count": 4},
    ])
    db.commit()

    result = _call(db, 6)
    names = [d.name for d in result]

    assert "location" in names
    assert "agent_email" not in names, "entity_key should be excluded"
    assert "hire_date" not in names, "time_key should be excluded"
    assert "base_salary" not in names, "financial_metric should be excluded"


def test_sort_order_table_count_desc_then_name_asc(tmp_path):
    """Results must be sorted: table_count DESC, name ASC within each count group."""
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 7)
    _seed_upload(db, 701, 7, "A.xlsx")
    _seed_upload(db, 702, 7, "B.xlsx")
    _seed_upload(db, 703, 7, "C.xlsx")

    # zzz_col and mmm_col in all 3 tables; aaa_col only in table A
    _seed_staging(db, 701, "unknown", [
        {"name": "zzz_col"}, {"name": "mmm_col"}, {"name": "aaa_col"},
    ])
    _seed_staging(db, 702, "unknown", [
        {"name": "zzz_col"}, {"name": "mmm_col"},
    ])
    _seed_staging(db, 703, "unknown", [
        {"name": "zzz_col"}, {"name": "mmm_col"},
    ])
    db.commit()

    result = _call(db, 7)
    # Branch 3: shared >= 2 → zzz_col (3), mmm_col (3), aaa_col excluded (only 1 table)
    names = [d.name for d in result]

    assert "aaa_col" not in names, "aaa_col is in only 1 table, branch 3 excludes it"
    assert names.index("mmm_col") < names.index("zzz_col") or names == sorted(
        [n for n in names if n in ("mmm_col", "zzz_col")]
    ), "within same table_count group, names should be alphabetical"
    # Both must appear before aaa_col (which is absent entirely)
    assert "mmm_col" in names
    assert "zzz_col" in names
    # Confirm alphabetical within the group
    assert names == sorted(names, key=lambda n: (-next(d.table_count for d in result if d.name == n), n))


def test_empty_dataset_returns_empty_list(tmp_path):
    """Dataset with no uploads → get_dimensions returns []."""
    Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, 8)
    db.commit()

    result = _call(db, 8)
    assert result == []
