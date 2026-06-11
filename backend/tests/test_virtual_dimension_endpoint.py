"""
TDD integration test for virtual_dimension.store_virtual_dimension().

Tests the full storage path: given fact-table DataFrames, the function
must create the physical staging table + StagingTable ORM record with
table_type='virtual_dimension' in profile_data.
"""
import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


def _make_test_db(tmp_path):
    """Create an isolated SQLite DB with all app tables."""
    db_path = tmp_path / "test_vd.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    # Create all tables from ORM metadata
    from core.database import Base
    import models.dataset       # noqa: F401 — register model
    import models.upload        # noqa: F401
    import models.staging_table  # noqa: F401
    import models.report_recipe  # noqa: F401
    import models.processed_table  # noqa: F401
    import models.kpi_definition  # noqa: F401
    import models.dashboard_config  # noqa: F401
    Base.metadata.create_all(engine)

    Session = sessionmaker(bind=engine)
    return engine, Session


def _seed_dataset(db, dataset_id=99, client_id="test_client"):
    """Insert a Dataset row so FKs are satisfied."""
    from models.dataset import Dataset
    ds = Dataset(id=dataset_id, client_id=client_id, name="test")
    db.add(ds)
    db.flush()
    return ds


def _seed_upload(db, upload_id, dataset_id, filename, client_id="test_client"):
    """Insert a synthetic Upload row."""
    from models.upload import Upload
    u = Upload(
        id=upload_id,
        client_id=client_id,
        dataset_id=dataset_id,
        s3_key=f"test/{filename}",
        filename=filename,
        status="profiled",
    )
    db.add(u)
    db.flush()
    return u


def _seed_staging(db, engine, upload_id, df, client_id="test_client"):
    """Write a DataFrame to a physical staging table and insert StagingTable record."""
    from models.staging_table import StagingTable
    from services.profiler import profile

    table_name = f"staging_{upload_id}"

    # Commit any pending ORM changes so SQLite releases its write lock
    # before pandas opens a second connection for to_sql.
    db.commit()
    df.to_sql(table_name, con=engine, index=False, if_exists="replace")

    prof = profile(df, upload_id)
    st = StagingTable(
        client_id=client_id,
        upload_id=upload_id,
        table_name=table_name,
        row_count=len(df),
        column_count=len(df.columns),
        duplicate_row_count=0,
        profile_data=prof.model_dump(),
    )
    db.add(st)
    db.flush()
    return st


# ---------------------------------------------------------------------------
# Test 1 — store_virtual_dimension creates StagingTable with correct type
# ---------------------------------------------------------------------------
def test_store_creates_staging_table_with_virtual_dimension_type(tmp_path):
    """
    Two fact tables share agent_email and agent_name.
    store_virtual_dimension must create a new StagingTable record
    whose profile_data['table_type'] == 'virtual_dimension'.
    """
    from services.virtual_dimension import store_virtual_dimension
    from models.staging_table import StagingTable

    engine, Session = _make_test_db(tmp_path)
    db = Session()

    _seed_dataset(db, dataset_id=99)
    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
        "rubric_score": [85.0, 90.0],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
        "adherence_pct": [95.0, 88.0],
    })
    _seed_upload(db, upload_id=901, dataset_id=99, filename="QA.xlsx")
    _seed_upload(db, upload_id=902, dataset_id=99, filename="Adherence.xlsx")
    _seed_staging(db, engine, 901, df1)
    _seed_staging(db, engine, 902, df2)
    db.commit()

    result = store_virtual_dimension(
        dataset_id=99,
        staging_dfs=[("staging_901", df1), ("staging_902", df2)],
        db=db,
        engine=engine,
        client_id="test_client",
    )

    assert result is not None, "expected a StagingTable, got None"
    assert result.profile_data["table_type"] == "virtual_dimension"
    assert result.row_count == 2  # 2 unique agents


# ---------------------------------------------------------------------------
# Test 2 — store returns None when no common dimension columns
# ---------------------------------------------------------------------------
def test_store_returns_none_when_no_common_columns(tmp_path):
    """
    Tables share no non-numeric columns → store_virtual_dimension returns None.
    """
    from services.virtual_dimension import store_virtual_dimension

    engine, Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, dataset_id=100)
    db.commit()

    df1 = pd.DataFrame({"only_numeric": [1.0, 2.0]})
    df2 = pd.DataFrame({"different_col": [3.0, 4.0]})

    result = store_virtual_dimension(
        dataset_id=100,
        staging_dfs=[("t1", df1), ("t2", df2)],
        db=db,
        engine=engine,
        client_id="test_client",
    )

    assert result is None


# ---------------------------------------------------------------------------
# Test 3 — physical staging table written to the database
# ---------------------------------------------------------------------------
def test_store_writes_physical_staging_table(tmp_path):
    """
    After store_virtual_dimension, a SELECT from the new staging table
    must return the expected rows.
    """
    from services.virtual_dimension import store_virtual_dimension

    engine, Session = _make_test_db(tmp_path)
    db = Session()
    _seed_dataset(db, dataset_id=101)
    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "agent_name": ["Alice", "Bob", "Carol"],
        "qa_score": [88.0, 91.0, 79.0],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "agent_name": ["Alice", "Bob", "Carol"],
        "csat_score": [4.5, 4.0, 4.8],
    })
    _seed_upload(db, upload_id=1001, dataset_id=101, filename="QA.xlsx")
    _seed_upload(db, upload_id=1002, dataset_id=101, filename="CSAT.xlsx")
    _seed_staging(db, engine, 1001, df1)
    _seed_staging(db, engine, 1002, df2)
    db.commit()

    st = store_virtual_dimension(
        dataset_id=101,
        staging_dfs=[("staging_1001", df1), ("staging_1002", df2)],
        db=db,
        engine=engine,
        client_id="test_client",
    )

    assert st is not None
    # Read back from physical table
    result_df = pd.read_sql(f'SELECT * FROM "{st.table_name}"', con=engine)
    assert len(result_df) == 3
    assert "agent_email" in result_df.columns
    assert "agent_name" in result_df.columns
