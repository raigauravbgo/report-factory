"""
RED-phase tests for the per-KPI filter-enrichment fix in compute.py.

These tests target NEW functionality that does not yet exist:
  - _apply_same_dimension_enrichment(dfs, table_names, filter_cols)
  - filter_cols kwarg on _load_staging_df

ALL tests are expected to FAIL until the production code is implemented.
"""
import inspect

import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Test 1 — basic enrichment via shared agent_email key
# ---------------------------------------------------------------------------
def test_enrich_missing_filter_col_via_agent_email():
    """
    df_qa has no 'location' column.
    df_csat has 'location' and shares 'agent_email' with df_qa.
    After enrichment, df_qa rows must have a 'location' value.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_qa = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "rubric_score": [85, 90],
    })
    df_csat = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "location": ["Gurgaon", "Manila"],
        "avg_csat_rating": [4.5, 3.8],
    })

    result = _apply_same_dimension_enrichment(
        [df_qa, df_csat],
        ["staging_qa", "staging_csat"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame), "Result must be a DataFrame"
    assert "location" in result.columns, "Enriched result must contain 'location' column"

    # Rows that originally came from df_qa must now carry location values
    qa_rows = result[result["rubric_score"].notna()].copy()
    assert not qa_rows.empty, "QA rows must not be dropped"
    assert qa_rows["location"].notna().all(), (
        "All QA rows should have a non-null location after enrichment via agent_email"
    )

    # Spot-check: alice → Gurgaon, bob → Manila
    alice_row = qa_rows[qa_rows["agent_email"] == "alice@x.com"]
    assert len(alice_row) == 1
    assert alice_row.iloc[0]["location"] == "Gurgaon"

    bob_row = qa_rows[qa_rows["agent_email"] == "bob@x.com"]
    assert len(bob_row) == 1
    assert bob_row.iloc[0]["location"] == "Manila"


# ---------------------------------------------------------------------------
# Test 2 — enrich multiple missing filter columns at once
# ---------------------------------------------------------------------------
def test_enrich_multiple_missing_cols():
    """
    filter_cols = ["location", "department"].
    df_qa is missing both; df_csat has both.
    Result must contain both columns.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_qa = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "rubric_score": [85, 90],
    })
    df_csat = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "location": ["Gurgaon", "Manila"],
        "department": ["Ops", "Support"],
        "avg_csat_rating": [4.5, 3.8],
    })

    result = _apply_same_dimension_enrichment(
        [df_qa, df_csat],
        ["staging_qa", "staging_csat"],
        ["location", "department"],
    )

    assert isinstance(result, pd.DataFrame)
    assert "location" in result.columns, "Must have 'location' column"
    assert "department" in result.columns, "Must have 'department' column"

    qa_rows = result[result["rubric_score"].notna()]
    assert not qa_rows.empty
    assert qa_rows["location"].notna().all(), "QA rows must have non-null location"
    assert qa_rows["department"].notna().all(), "QA rows must have non-null department"


# ---------------------------------------------------------------------------
# Test 3 — table that already has the filter column is unchanged
# ---------------------------------------------------------------------------
def test_enrich_table_already_has_col_unchanged():
    """
    df_adherence already has 'location'.
    It must not be duplicated or have rows added after enrichment.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_adherence = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "location": ["Gurgaon", "Manila", "Gurgaon"],
        "min_in_adherence": [95.0, 88.0, 91.0],
    })
    df_qa = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "rubric_score": [85, 90, 78],
    })

    result = _apply_same_dimension_enrichment(
        [df_adherence, df_qa],
        ["staging_adherence", "staging_qa"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame)
    # Adherence rows should not be duplicated
    adherence_rows = result[result["min_in_adherence"].notna()]
    assert len(adherence_rows) == 3, (
        f"df_adherence should contribute exactly 3 rows, got {len(adherence_rows)}"
    )
    # location column should still be present
    assert "location" in result.columns


# ---------------------------------------------------------------------------
# Test 4 — no shared join key → graceful fallback, no crash
# ---------------------------------------------------------------------------
def test_enrich_no_shared_key_falls_back_gracefully():
    """
    df_a and df_b share no column that can act as a join key.
    The function must not raise; df_a rows may have NaN for location.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_a = pd.DataFrame({
        "x_col": ["row1", "row2"],
        "value_a": [10, 20],
    })
    df_b = pd.DataFrame({
        "y_col": ["r1", "r2"],
        "location": ["Gurgaon", "Manila"],
        "value_b": [100, 200],
    })

    # Must not raise — result is a valid DataFrame regardless
    result = _apply_same_dimension_enrichment(
        [df_a, df_b],
        ["staging_a", "staging_b"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame), "Must return a DataFrame even with no shared key"
    assert len(result) > 0, "Result must not be empty"


# ---------------------------------------------------------------------------
# Test 5 — _load_staging_df accepts filter_cols kwarg (signature check)
# ---------------------------------------------------------------------------
def test_load_staging_df_passes_filter_cols_to_enrichment():
    """
    _load_staging_df must accept a filter_cols keyword argument.
    Calling it with filter_cols=[] (and an empty table list) must not raise TypeError.
    We only verify the function signature — no real DB call is made.
    """
    from services.compute import _load_staging_df  # noqa: PLC0415

    sig = inspect.signature(_load_staging_df)
    assert "filter_cols" in sig.parameters, (
        "_load_staging_df must have a 'filter_cols' parameter "
        "(currently missing — this is the RED state)"
    )

    # Verify calling with filter_cols=[] does not raise TypeError
    # We can't pass real table names (no DB), so we just test the signature path.
    # Passing an empty list for table_name also avoids a DB hit.
    try:
        _load_staging_df([], filter_cols=[])
    except TypeError as exc:
        pytest.fail(f"_load_staging_df raised TypeError with filter_cols=[]: {exc}")
    except Exception:
        # Any other exception (DB-related, etc.) is acceptable in the RED phase —
        # we only care that TypeError is not raised for the kwarg itself.
        pass


# ---------------------------------------------------------------------------
# Test 6 — lower-level enrichment: QA rows get location after join
# ---------------------------------------------------------------------------
def test_compute_dashboard_with_location_filter_on_table_without_location_col():
    """
    Simulates the real-world bug scenario at the enrichment level:
    df_qa has no 'location' column; df_csat does.
    After enrichment, agents present in both tables must have non-NaN location
    on their rubric_score rows.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_csat = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "location": ["Gurgaon", "Manila", "Gurgaon"],
        "avg_csat_rating": [4.5, 3.8, 4.1],
    })
    df_qa = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com", "carol@x.com"],
        "rubric_score": [85, 90, 78],
    })

    result = _apply_same_dimension_enrichment(
        [df_csat, df_qa],
        ["staging_csat", "staging_qa"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame)
    assert "location" in result.columns

    # QA rows (those with rubric_score) must NOT have NaN location after enrichment
    qa_rows = result[result["rubric_score"].notna()]
    assert not qa_rows.empty, "QA rows should not be dropped"
    assert qa_rows["location"].notna().all(), (
        "Agents in both tables must have location propagated to QA rows; "
        "a filter on location=Gurgaon would otherwise zero out QA Score"
    )


# ---------------------------------------------------------------------------
# Test 7 — total row count is preserved (no cross-join explosion)
# ---------------------------------------------------------------------------
def test_enrichment_preserves_row_count():
    """
    df_qa: 3 rows, df_csat: 3 rows → total should be 6 after enrichment.
    The many-to-one join must not produce duplicate rows.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    df_qa = pd.DataFrame({
        "agent_email": ["a@x.com", "b@x.com", "c@x.com"],
        "rubric_score": [10, 20, 30],
    })
    df_csat = pd.DataFrame({
        "agent_email": ["a@x.com", "b@x.com", "c@x.com"],
        "location": ["L1", "L2", "L3"],
        "avg_csat_rating": [4.0, 3.5, 4.8],
    })

    result = _apply_same_dimension_enrichment(
        [df_qa, df_csat],
        ["staging_qa", "staging_csat"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame)
    assert len(result) == 6, (
        f"Expected 6 total rows (3 QA + 3 CSAT), got {len(result)}. "
        "Enrichment must not produce a cross-join explosion."
    )

    # df_qa's 3 rows must all be present
    qa_rows = result[result["rubric_score"].notna()]
    assert len(qa_rows) == 3, (
        f"Expected exactly 3 QA rows, got {len(qa_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 8 — dtype mismatch on join key is handled (int64 vs object)
# ---------------------------------------------------------------------------
def test_enrich_handles_join_key_dtype_mismatch():
    """
    If the join key has different dtypes in the two tables (int64 vs object),
    the merge must still succeed without raising ValueError.

    This exercises the coercion path:
        if left_df[join_key].dtype != lookup[join_key].dtype:
            left_df[join_key] = left_df[join_key].astype(str)
            lookup[join_key] = lookup[join_key].astype(str)
    """
    from services.compute import _apply_same_dimension_enrichment

    # df_qa has agent_id as int64
    df_qa = pd.DataFrame({
        "agent_id": pd.array([101, 102, 103], dtype="int64"),
        "rubric_score": [85, 90, 78],
    })
    # df_adherence has agent_id as object (string)
    df_adherence = pd.DataFrame({
        "agent_id": ["101", "102", "103"],
        "location": ["Gurgaon", "Manila", "Gurgaon"],
        "min_in_adherence": [95.0, 88.0, 91.0],
    })

    # Must not raise ValueError about merging int64 with object
    result = _apply_same_dimension_enrichment(
        [df_qa, df_adherence],
        ["staging_qa", "staging_adherence"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame), "Must return a DataFrame"
    assert "location" in result.columns, "location column must be present after enrichment"
    qa_rows = result[result["rubric_score"].notna()]
    assert not qa_rows.empty, "QA rows must survive"
    assert qa_rows["location"].notna().all(), (
        "All QA rows must have non-null location despite int64/object join key mismatch"
    )


# ---------------------------------------------------------------------------
# Test 9 — donor with duplicate join key values (no row explosion)
# ---------------------------------------------------------------------------
def test_enrich_donor_with_duplicate_join_key_no_explosion():
    """
    A donor table with multiple rows per join key value (e.g. an agent appears
    twice in CSAT) must produce exactly 1 enriched row per QA row — not a
    cartesian join.  The drop_duplicates(subset=[join_key]) guard is what
    prevents this explosion.
    """
    from services.compute import _apply_same_dimension_enrichment

    df_qa = pd.DataFrame({
        "agent_email": ["alice@x.com", "bob@x.com"],
        "rubric_score": [85, 90],
    })
    # alice appears twice in donor (two surveys) — should not create 2 QA rows for alice
    df_csat = pd.DataFrame({
        "agent_email": ["alice@x.com", "alice@x.com", "bob@x.com"],
        "location": ["Gurgaon", "Gurgaon", "Manila"],
        "avg_csat_rating": [4.5, 4.2, 3.8],
    })

    result = _apply_same_dimension_enrichment(
        [df_qa, df_csat],
        ["staging_qa", "staging_csat"],
        ["location"],
    )

    qa_rows = result[result["rubric_score"].notna()]
    assert len(qa_rows) == 2, (
        f"Expected 2 QA rows (one per agent), got {len(qa_rows)}. "
        "Donor duplicate join key must not cause row explosion."
    )


# ---------------------------------------------------------------------------
# Test 10 — filter column absent from every sibling table → valid df returned
# ---------------------------------------------------------------------------
def test_enrich_filter_col_missing_from_all_siblings():
    """
    The filter column doesn't exist in any table.
    The function must not crash; it should return a valid concat of all tables.
    """
    from services.compute import _apply_same_dimension_enrichment

    df_a = pd.DataFrame({"agent_email": ["a@x.com"], "metric_a": [1]})
    df_b = pd.DataFrame({"agent_email": ["b@x.com"], "metric_b": [2]})

    # "nonexistent_col" is not in df_a or df_b
    result = _apply_same_dimension_enrichment(
        [df_a, df_b],
        ["staging_a", "staging_b"],
        ["nonexistent_col"],
    )

    assert isinstance(result, pd.DataFrame), "Must return a DataFrame"
    assert len(result) == 2, "All rows must be preserved even when filter col is absent everywhere"


# ---------------------------------------------------------------------------
# Test 11 — three-table dataset: enrichment runs across all tables
# ---------------------------------------------------------------------------
def test_enrich_three_table_dataset():
    """
    With 3 tables (CSAT, QA, Adherence), the table missing a filter col (QA)
    should get it from the best donor (CSAT) while tables that already have
    the column (CSAT, Adherence) are untouched.  Total row count = 3+3+3 = 9.
    """
    from services.compute import _apply_same_dimension_enrichment

    df_csat = pd.DataFrame({
        "agent_email": ["a@x.com", "b@x.com", "c@x.com"],
        "location": ["Gurgaon", "Manila", "Heredia"],
        "avg_csat_rating": [4.5, 3.8, 4.1],
    })
    df_qa = pd.DataFrame({
        "agent_email": ["a@x.com", "b@x.com", "c@x.com"],
        "rubric_score": [85, 90, 78],
    })
    df_adherence = pd.DataFrame({
        "agent_email": ["d@x.com", "e@x.com", "f@x.com"],
        "location": ["Philippines", "Philippines", "Philippines"],
        "min_in_adherence": [95.0, 88.0, 91.0],
    })

    result = _apply_same_dimension_enrichment(
        [df_csat, df_qa, df_adherence],
        ["staging_csat", "staging_qa", "staging_adherence"],
        ["location"],
    )

    assert isinstance(result, pd.DataFrame)
    assert len(result) == 9, f"Expected 9 total rows (3+3+3), got {len(result)}"
    assert "location" in result.columns

    # QA rows must have location propagated from CSAT
    qa_rows = result[result["rubric_score"].notna()]
    assert len(qa_rows) == 3
    assert qa_rows["location"].notna().all(), "QA rows must have location after enrichment"


# ---------------------------------------------------------------------------
# Test 12 — _find_cross_name_join_key: detects email ↔ agent_email overlap
# ---------------------------------------------------------------------------
def test_find_cross_name_join_key_detects_email_variants():
    """
    Roster.email and CSAT.agent_email contain the same values under different
    column names.  _find_cross_name_join_key must return ("email", "agent_email").
    """
    from services.compute import _find_cross_name_join_key  # noqa: PLC0415

    emails = [f"user{i}@x.com" for i in range(100)]
    df_roster = pd.DataFrame({
        "email": emails,
        "workday_name": [f"Name {i}" for i in range(100)],
        "team_lead_supervisor": [f"TL-{i % 5}" for i in range(100)],
    })
    df_csat = pd.DataFrame({
        "agent_email": emails,
        "avg_csat_rating": [4.0] * 100,
        "location": ["Gurgaon"] * 50 + ["Manila"] * 50,
    })

    result = _find_cross_name_join_key(df_roster, df_csat)

    assert result is not None, "_find_cross_name_join_key must find the email↔agent_email pair"
    left_col, right_col = result
    assert left_col == "email", f"Expected left_col='email', got '{left_col}'"
    assert right_col == "agent_email", f"Expected right_col='agent_email', got '{right_col}'"


# ---------------------------------------------------------------------------
# Test 13 — _find_cross_name_join_key: returns None when no sufficient overlap
# ---------------------------------------------------------------------------
def test_find_cross_name_join_key_returns_none_when_no_overlap():
    """
    When no column pair has >=65% value overlap, the function returns None
    without raising.
    """
    from services.compute import _find_cross_name_join_key  # noqa: PLC0415

    df_a = pd.DataFrame({"x_id": ["a", "b", "c"], "val": [1, 2, 3]})
    df_b = pd.DataFrame({"y_id": ["d", "e", "f"], "location": ["G", "M", "H"]})

    result = _find_cross_name_join_key(df_a, df_b)

    assert result is None, (
        f"Expected None when there is no value overlap, got {result}"
    )


# ---------------------------------------------------------------------------
# Test 14 — enrichment via cross-name key: Roster.email → CSAT.agent_email
# ---------------------------------------------------------------------------
def test_enrich_roster_to_fact_via_cross_name_key():
    """
    Simulates Roster dimension joining to CSAT fact table via cross-name key
    (Roster.email ↔ CSAT.agent_email).  team_lead_supervisor must propagate to
    CSAT rows even though the two tables share no identically-named join key.
    """
    from services.compute import _apply_same_dimension_enrichment  # noqa: PLC0415

    emails = [f"u{i}@x.com" for i in range(5)]
    df_roster = pd.DataFrame({
        "email": emails,
        "team_lead_supervisor": ["TL-A", "TL-A", "TL-B", "TL-B", "TL-C"],
        "workday_name": [f"Name {i}" for i in range(5)],
    })
    df_csat = pd.DataFrame({
        "agent_email": emails,
        "avg_csat_rating": [4.0, 3.5, 4.2, 3.8, 4.6],
    })

    result = _apply_same_dimension_enrichment(
        [df_roster, df_csat],
        ["staging_roster", "staging_csat"],
        ["team_lead_supervisor"],
    )

    assert isinstance(result, pd.DataFrame)
    assert "team_lead_supervisor" in result.columns, (
        "team_lead_supervisor must be present after cross-name enrichment"
    )
    csat_rows = result[result["avg_csat_rating"].notna()]
    assert not csat_rows.empty, "CSAT rows must not be dropped"
    assert csat_rows["team_lead_supervisor"].notna().all(), (
        "All CSAT rows must have team_lead_supervisor after enrichment via "
        "cross-name key Roster.email ↔ CSAT.agent_email"
    )
    # Spot-check: u0 and u1 → TL-A
    assert csat_rows[csat_rows["agent_email"] == "u0@x.com"].iloc[0]["team_lead_supervisor"] == "TL-A"
    assert csat_rows[csat_rows["agent_email"] == "u2@x.com"].iloc[0]["team_lead_supervisor"] == "TL-B"


# ---------------------------------------------------------------------------
# Test 15 — _classify_table_type: roster-like data → "dimension"
# ---------------------------------------------------------------------------
def test_classify_dimension_table():
    """
    A small table with no measure/date columns must be classified as 'dimension'.
    Typical example: Roster with employee attributes only.
    """
    from services.profiler import _classify_table_type  # noqa: PLC0415

    col_profiles = [
        {"suggested_role": "dimension"} for _ in range(8)
    ]
    result = _classify_table_type(row_count=300, col_profiles=col_profiles)
    assert result == "dimension", (
        f"Expected 'dimension' for small all-dimension-column table, got '{result}'"
    )


# ---------------------------------------------------------------------------
# Test 16 — _classify_table_type: CSAT-like data → "fact"
# ---------------------------------------------------------------------------
def test_classify_fact_table():
    """
    A table with date and measure columns must be classified as 'fact'.
    Typical example: CSAT survey data with avg_rating and survey_date.
    """
    from services.profiler import _classify_table_type  # noqa: PLC0415

    col_profiles = [
        {"suggested_role": "date"},
        {"suggested_role": "measure"},
        {"suggested_role": "measure"},
        {"suggested_role": "dimension"},
        {"suggested_role": "dimension"},
    ]
    result = _classify_table_type(row_count=18000, col_profiles=col_profiles)
    assert result == "fact", (
        f"Expected 'fact' for table with date and measure columns, got '{result}'"
    )


# ---------------------------------------------------------------------------
# Test 17 — cross-name probe uses unique-value sampling (Bug 1 regression test)
# ---------------------------------------------------------------------------
def test_cross_name_probe_uses_unique_sampling():
    """
    QA data is sorted: the first 200 rows are all for Agent-0, whose email is NOT in
    Roster.  Agents 1-99 ARE in Roster.

    With head(200): left_sample = {"agent0@x.com"} → overlap 0/1 = 0% → probe returns None.
    With unique()[:200]: left_sample = 100 distinct emails → 99 of 100 in Roster → 99% → OK.

    This test verifies the bug fix: the probe must use unique sampling.
    """
    from services.compute import _find_cross_name_join_key  # noqa: PLC0415

    all_agents = [f"agent{i}@x.com" for i in range(100)]
    roster_agents = all_agents[1:]  # agents 1-99; agent-0 is NOT in Roster

    # First 200 rows are all for agent-0 (simulates data sorted by agent)
    qa_emails = [all_agents[0]] * 200 + all_agents[1:]
    left_df = pd.DataFrame({
        "agent_email": qa_emails,
        "rubric_score": range(len(qa_emails)),
    })
    right_df = pd.DataFrame({
        "email": roster_agents,
        "one_up_manager": [f"Mgr{i % 5}" for i in range(len(roster_agents))],
    })

    result = _find_cross_name_join_key(left_df, right_df)

    assert result is not None, (
        "Cross-name probe must find agent_email→email when unique sampling is used. "
        "If this fails, head() is being used instead of unique()."
    )
    left_col, right_col = result
    assert left_col == "agent_email", f"Expected left_col='agent_email', got '{left_col}'"
    assert right_col == "email", f"Expected right_col='email', got '{right_col}'"


# ---------------------------------------------------------------------------
# Test 18 — enrichment prefers cross-name key when it has higher cardinality
# ---------------------------------------------------------------------------
def test_enrich_prefers_cross_name_over_low_cardinality_same_name():
    """
    Fact table shares column 'pod' with Roster (same-name, cardinality 3).
    Fact table also has 'agent_email' which overlaps with Roster.email (cross-name, cardinality 50).

    Before fix: join uses pod → agent a3 (Pod0) wrongly gets Mgr0 instead of Mgr3.
    After fix:  join uses agent_email→email (higher cardinality) → a3 correctly gets Mgr3.
    """
    from services.compute import _enrich_dfs  # noqa: PLC0415

    agents = [f"a{i}@x.com" for i in range(50)]

    df_roster = pd.DataFrame({
        "email": agents,
        "one_up_manager": [f"Mgr{i % 5}" for i in range(50)],
        "pod": [f"Pod{i % 3}" for i in range(50)],   # same column name as fact table
    })
    df_fact = pd.DataFrame({
        "agent_email": agents,
        "pod": [f"Pod{i % 3}" for i in range(50)],   # shared same-name col, cardinality 3
        "rubric_score": [float(i) for i in range(50)],
    })

    result = _enrich_dfs(
        [df_roster, df_fact],
        ["staging_roster", "staging_fact"],
        ["one_up_manager"],
    )

    fact_enriched = result[1]
    assert "one_up_manager" in fact_enriched.columns

    # Agent a3 is in Pod0 but has manager Mgr3 (since 3 % 5 == 3).
    # A pod-based join (wrong) would assign Mgr0 (the first agent in Pod0).
    # An agent_email-based join (correct) assigns Mgr3.
    row_a3 = fact_enriched[fact_enriched["agent_email"] == "a3@x.com"].iloc[0]
    assert row_a3["one_up_manager"] == "Mgr3", (
        f"Expected agent-level manager Mgr3 for a3@x.com, got {row_a3['one_up_manager']}. "
        "If Mgr0, enrichment is using the low-cardinality pod key instead of agent_email."
    )


# ---------------------------------------------------------------------------
# Test 19 — pass-2 transitive enrichment: QA → enriched-CSAT → one_up_manager
# ---------------------------------------------------------------------------
def test_enrich_pass2_transitive_via_sibling():
    """
    QA shares no column name with Roster and the cross-name probe between QA and Roster
    fails (different email domains → overlap below threshold).
    CSAT is enriched from Roster in pass 1 (via department, same-name key).
    In pass 2, QA enriches from enriched-CSAT via agent_email (same-name), inheriting
    one_up_manager transitively.
    """
    from services.compute import _enrich_dfs  # noqa: PLC0415

    qa_agents = [f"qa{i}@company.com" for i in range(10)]
    roster_agents = [f"roster{i}@company.com" for i in range(50)]  # different domain → no overlap

    df_roster = pd.DataFrame({
        "email": roster_agents,
        "one_up_manager": [f"Mgr{i % 3}" for i in range(50)],
        "department": [f"Dept{i % 5}" for i in range(50)],
    })
    # CSAT shares department (same-name) with Roster → enriched in pass 1
    df_csat = pd.DataFrame({
        "agent_email": qa_agents,             # same agents as QA
        "department": [f"Dept{i % 5}" for i in range(10)],
        "avg_csat_rating": [4.0] * 10,
    })
    # QA: no column in common with Roster; shares agent_email with enriched-CSAT
    df_qa = pd.DataFrame({
        "agent_email": qa_agents,
        "rubric_score": [85.0] * 10,
    })

    result = _enrich_dfs(
        [df_roster, df_csat, df_qa],
        ["staging_roster", "staging_csat", "staging_qa"],
        ["one_up_manager"],
    )

    qa_enriched = result[2]
    assert "one_up_manager" in qa_enriched.columns, (
        "QA must receive one_up_manager from Roster transitively via enriched-CSAT in pass 2"
    )
    assert qa_enriched["one_up_manager"].notna().all(), (
        "Every QA row must have one_up_manager populated after pass-2 enrichment"
    )
