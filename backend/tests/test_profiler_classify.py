"""
Tests for the profiler's column type detection, specifically the
metric-name override for low-cardinality numeric columns.

Before the fix, any numeric column with unique_count <= 5 was
classified as "categorical/dimension" regardless of name, causing
KPI-relevant columns like csat_score and avg_csat_rating to be hidden
from the KPI suggester.
"""
import pandas as pd
import pytest


def _classify(series, name):
    """Import and call _classify directly for unit testing."""
    from services.profiler import _classify  # noqa: PLC0415
    non_null = series.dropna()
    unique_count = int(series.nunique(dropna=True))
    total = len(series)
    return _classify(series, name, non_null, unique_count, total)


# ---------------------------------------------------------------------------
# Test 1 — binary csat_score (0/1) must be numeric/measure
# ---------------------------------------------------------------------------
def test_csat_score_binary_classified_as_measure():
    """
    csat_score with only 0/1 values (unique_count=2) must be numeric/measure
    because the name contains 'score'.
    """
    series = pd.Series([1, 1, 0, 1, 1, 0, 1, 1, 1, 0])
    dtype, role = _classify(series, "csat_score")
    assert dtype == "numeric", f"expected numeric, got {dtype!r}"
    assert role == "measure", f"expected measure, got {role!r}"


# ---------------------------------------------------------------------------
# Test 2 — avg_csat_rating (1-5 scale, unique_count=5) must be numeric/measure
# ---------------------------------------------------------------------------
def test_avg_csat_rating_scale_classified_as_measure():
    """
    avg_csat_rating with values 1-5 must be numeric/measure
    because the name contains 'rating'.
    """
    series = pd.Series([5, 5, 2, 5, 5, 4, 3, 5, 1, 5])
    dtype, role = _classify(series, "avg_csat_rating")
    assert dtype == "numeric", f"expected numeric, got {dtype!r}"
    assert role == "measure", f"expected measure, got {role!r}"


# ---------------------------------------------------------------------------
# Test 3 — csat_survey_volume with all-1 values must be numeric/measure
# ---------------------------------------------------------------------------
def test_csat_survey_volume_classified_as_measure():
    """
    csat_survey_volume (all 1s → unique_count=1) must be numeric/measure
    because the name contains 'volume'.
    """
    series = pd.Series([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    dtype, role = _classify(series, "csat_survey_volume")
    assert dtype == "numeric", f"expected numeric, got {dtype!r}"
    assert role == "measure", f"expected measure, got {role!r}"


# ---------------------------------------------------------------------------
# Test 4 — is_deleted (0/1 flag, no metric keyword) stays categorical
# ---------------------------------------------------------------------------
def test_is_deleted_binary_stays_categorical():
    """
    is_deleted with only 0/1 values and no metric keyword must remain
    categorical/dimension — it's a flag, not a KPI.
    """
    series = pd.Series([0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    dtype, role = _classify(series, "is_deleted")
    assert dtype == "categorical", f"expected categorical, got {dtype!r}"
    assert role == "dimension", f"expected dimension, got {role!r}"


# ---------------------------------------------------------------------------
# Test 5 — qa_score with numeric string values must be numeric/measure
# ---------------------------------------------------------------------------
def test_qa_score_string_numerics_classified_as_measure():
    """
    qa_score stored as text strings ("85", "90", "78") with unique_count > 5
    must still be numeric/measure via the string-numeric detection path.
    """
    series = pd.Series(["85", "90", "78", "92", "88", "76", "95", "82", "79", "91"])
    dtype, role = _classify(series, "qa_score")
    assert dtype == "numeric", f"expected numeric, got {dtype!r}"
    assert role == "measure", f"expected measure, got {role!r}"


# ---------------------------------------------------------------------------
# Test 6 — adherence_pct with few unique percent values must be numeric/measure
# ---------------------------------------------------------------------------
def test_adherence_pct_classified_as_measure():
    """
    adherence_pct with 3 unique values (90, 95, 100) must be numeric/measure
    because the name contains 'pct'.
    """
    series = pd.Series([90, 95, 100, 90, 95, 90, 100, 95, 90, 95])
    dtype, role = _classify(series, "adherence_pct")
    assert dtype == "numeric", f"expected numeric, got {dtype!r}"
    assert role == "measure", f"expected measure, got {role!r}"
