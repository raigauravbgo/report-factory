"""
TDD tests for virtual_dimension.build_virtual_dimension().

The virtual dimension is a generated dimension table built from columns
that appear consistently across 2+ fact tables when no real Roster/dimension
file was uploaded. It lets dimension-based filters work even without Roster.

Single-table mode (auto-triggered when only 1 fact table is available):
only columns that are STABLE per entity (same value for all rows of that
agent) are included — evaluation-specific columns like rubric_name are
excluded even though they are non-numeric.
"""
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Test 1 — columns shared across 2+ tables are included
# ---------------------------------------------------------------------------
def test_common_categorical_columns_included():
    """
    agent_email and agent_name appear in both df1 and df2.
    Both must be present in the virtual dimension output.
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
        "rubric_score": [85, 90],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
        "adherence_pct": [95, 88],
    })

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    assert result is not None
    assert "agent_email" in result.columns
    assert "agent_name" in result.columns


# ---------------------------------------------------------------------------
# Test 2 — column only in one table is excluded
# ---------------------------------------------------------------------------
def test_single_table_column_excluded():
    """
    location only appears in df1 (not df2). It must not appear in the
    virtual dimension because it's not a cross-table shared attribute.
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
        "location": ["Boston", "London"],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
    })

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    assert result is not None
    assert "location" not in result.columns


# ---------------------------------------------------------------------------
# Test 3 — numeric columns excluded even when shared across tables
# ---------------------------------------------------------------------------
def test_numeric_shared_columns_excluded():
    """
    rubric_score is numeric and appears in both tables.
    It must NOT be in the virtual dimension — numerics are measures, not dims.
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "rubric_score": [85.0, 90.0],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "rubric_score": [87.0, 91.0],
    })

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    # Only agent_email is common and non-numeric; rubric_score excluded
    assert result is None or "rubric_score" not in result.columns


# ---------------------------------------------------------------------------
# Test 4 — no common non-numeric columns returns None
# ---------------------------------------------------------------------------
def test_no_common_columns_returns_none():
    """
    Tables share no non-numeric columns → returns None (cannot build dim).
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({"col_a": ["x", "y"]})
    df2 = pd.DataFrame({"col_b": ["p", "q"]})

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    assert result is None


# ---------------------------------------------------------------------------
# Test 5 — empty input returns None
# ---------------------------------------------------------------------------
def test_empty_input_returns_none():
    """No staging DataFrames → returns None."""
    from services.virtual_dimension import build_virtual_dimension

    assert build_virtual_dimension([]) is None


# ---------------------------------------------------------------------------
# Test 6 — rows deduplicated by entity key
# ---------------------------------------------------------------------------
def test_rows_deduplicated_by_entity_key():
    """
    alice@x.com appears 3 times across both tables combined.
    The virtual dimension must contain exactly one row per agent.
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Alice", "Bob"],
    })
    df2 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "agent_name": ["Alice", "Bob"],
    })

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    assert result is not None
    assert len(result) == 2
    assert set(result["agent_email"]) == {"alice@x.com", "bob@x.com"}


# ---------------------------------------------------------------------------
# Test 7 — entity key is the highest-cardinality shared column
# ---------------------------------------------------------------------------
def test_entity_key_is_highest_cardinality_column():
    """
    agent_email has 5 unique values, department has 2.
    The virtual dim must be keyed by agent_email (deduped to 5 rows, not 2).
    """
    from services.virtual_dimension import build_virtual_dimension

    emails = [f"agent{i}@x.com" for i in range(5)]
    depts = ["CX", "Sales", "CX", "Sales", "CX"]

    df1 = pd.DataFrame({"agent_email": emails, "department": depts})
    df2 = pd.DataFrame({"agent_email": emails, "department": depts})

    result = build_virtual_dimension([("t1", df1), ("t2", df2)])

    assert result is not None
    # 5 unique agents, not 2 unique departments
    assert len(result) == 5


# ---------------------------------------------------------------------------
# Test 8 — single staging table, min_tables=1 override works
# ---------------------------------------------------------------------------
def test_single_table_with_min_tables_one():
    """
    With min_tables=1, columns from even a single table are included.
    Useful when user has only one fact file but wants dimension columns.
    """
    from services.virtual_dimension import build_virtual_dimension

    df1 = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "location": ["Boston", "London"],
    })

    result = build_virtual_dimension([("t1", df1)], min_tables=1)

    assert result is not None
    assert "agent_email" in result.columns
    assert "location" in result.columns


# ---------------------------------------------------------------------------
# Test 9 — single-table auto mode: stable columns included
# ---------------------------------------------------------------------------
def test_single_table_auto_includes_stable_columns():
    """
    build_virtual_dimension with a single table and min_tables=1 must
    only include columns whose value does not vary within each entity.

    5 agents × 2 evaluations each.
    agent_name is the SAME for all rows of each agent → included.
    rubric_name CHANGES between rows for the same agent → excluded.
    agent_email has the highest cardinality (5) → entity key.
    """
    from services.virtual_dimension import build_virtual_dimension

    # 5 agents, each with 2 evaluations using different rubrics
    emails = [f"agent{i}@x.com" for i in range(5) for _ in range(2)]  # 10 rows
    names  = [f"Agent {i}"       for i in range(5) for _ in range(2)]
    rubrics = ["Rubric A", "Rubric B"] * 5  # alternates per evaluation

    df = pd.DataFrame({
        "agent_email": emails,
        "agent_name":  names,
        "rubric_name": rubrics,
    })

    result = build_virtual_dimension([("t1", df)], min_tables=1)

    assert result is not None
    assert "agent_email" in result.columns
    assert "agent_name" in result.columns
    # rubric_name varies per agent — must be excluded
    assert "rubric_name" not in result.columns
    # deduplicated: one row per agent
    assert len(result) == 5


# ---------------------------------------------------------------------------
# Test 10 — single-table auto mode: unstable column excluded, dim col kept
# ---------------------------------------------------------------------------
def test_single_table_auto_excludes_per_row_columns():
    """
    grade_type varies per evaluation even for the same agent → excluded.
    location is consistent for each agent → included.
    5 agents, each appearing in 2 rows.
    """
    from services.virtual_dimension import build_virtual_dimension

    emails    = [f"agent{i}@x.com" for i in range(5) for _ in range(2)]
    locations = [("Boston" if i < 3 else "London") for i in range(5) for _ in range(2)]
    grades    = ["standard", "calibration"] * 5  # alternates → unstable per agent

    df = pd.DataFrame({
        "agent_email": emails,
        "location":    locations,
        "grade_type":  grades,
    })

    result = build_virtual_dimension([("t1", df)], min_tables=1)

    assert result is not None
    assert "location" in result.columns
    assert "grade_type" not in result.columns
    assert len(result) == 5


# ---------------------------------------------------------------------------
# Test 11 — works with any column names (proves no hardcoding)
# ---------------------------------------------------------------------------
def test_entity_key_detection_is_name_agnostic():
    """
    The entity key must be chosen by cardinality, not by column name.
    Using completely non-email column names: staff_ref, full_name, skill_tag.
    staff_ref has 5 unique values (highest) → entity key.
    full_name is stable per staff_ref → included.
    skill_tag varies per staff_ref → excluded in single-table mode.
    """
    from services.virtual_dimension import build_virtual_dimension

    refs   = [f"REF-{i:03d}" for i in range(5) for _ in range(2)]
    names  = [f"Person {i}"  for i in range(5) for _ in range(2)]
    skills = ["Skill A", "Skill B"] * 5  # alternates → unstable

    df = pd.DataFrame({
        "staff_ref":  refs,
        "full_name":  names,
        "skill_tag":  skills,
    })

    result = build_virtual_dimension([("t1", df)], min_tables=1)

    assert result is not None
    assert "staff_ref" in result.columns
    assert "full_name" in result.columns
    assert "skill_tag" not in result.columns
    assert len(result) == 5


# ---------------------------------------------------------------------------
# Test 12 — store_virtual_dimension auto-detects min_tables=1 for 1 table
# ---------------------------------------------------------------------------
def test_store_auto_min_tables_single_file():
    """
    build_virtual_dimension with a single staging_df and min_tables=1
    (the auto-mode used by the endpoint) must return a result.
    """
    from services.virtual_dimension import build_virtual_dimension

    df = pd.DataFrame({
        "staff_id":  ["S001", "S002"],
        "full_name": ["Alice", "Bob"],
        "qa_score":  [88.0, 91.0],
    })

    # With auto-detected min_tables=1, should build from the single table
    result = build_virtual_dimension([("t1", df)], min_tables=1)

    assert result is not None
    assert "staff_id" in result.columns
    assert "full_name" in result.columns
    assert "qa_score" not in result.columns  # numeric → excluded
