# Drivers Tab — Ranked Dimensions with Expand

**Date:** 2026-06-15  
**Status:** Approved  

---

## Problem

The Drivers tab only shows `department` even when users select multiple dimensions (e.g. `department`, `location`, `pod`, `team_lead_supervisor`). Root cause: the backend uses `chart_layout` bar entries' `group_by` field to determine which dimensions appear in Drivers. The recipe generator only emits bar entries for the first dimension, so all other selected dimensions are silently dropped.

Two contributing bugs:
1. `dashboard.py` Branch A — uses bar entry `group_by` as the dimension source instead of `config.dimensions`
2. `dashboard.py` Branch B (fallback) — hard-caps at `[:3]`

---

## Goals

- Show **all user-selected dimensions** in Drivers, ranked by analytical impact
- Default view shows the **top-ranked dimension** (highest spread); remaining dimensions are behind a dynamic expand button
- No hardcoded numbers anywhere — counts are always derived from selection size
- Fix works for **existing recipes** without any data migration
- Trends dimensional split is **out of scope** — noted as future enhancement

---

## Design

### Backend — `backend/api/routes/dashboard.py`

**Replace the `bar_entries` dimension-scoping logic:**

- Always use `config.dimensions` as the source for `ordered_dims` (the user's explicit selection)
- Bar entries continue to control **which KPIs** appear in Drivers (unchanged behaviour)
- Remove the `[:3]` cap from the fallback branch

**Compute spread per dimension after building `dimension_breakdowns`:**

```python
# For each dimension, compute spread = (max - min) / mean
# averaged across all KPIs in that dimension
# Dimensions with no data get spread = 0.0
```

Formula per KPI per dimension:
```
spread_kpi = (max_segment_value - min_segment_value) / mean_value
             (skip if mean == 0 or fewer than 2 segments)
dimension_spread = average of spread_kpi across all KPIs in that dimension
```

**Sort `dimension_breakdowns` by spread descending.**

**Add `dimension_spreads` to the API response:**
```json
{
  "dimension_spreads": {
    "pod": 0.65,
    "department": 0.42,
    "location": 0.08,
    "team_lead_supervisor": 0.01
  }
}
```

This field is informational — the frontend uses it to order dimensions and optionally label low-spread dims.

---

### Frontend — `frontend/lib/types.ts`

Add one field to `DashboardData`:
```ts
dimension_spreads: Record<string, number>;
```

---

### Frontend — `frontend/app/dashboard/[recipeId]/page.tsx` (Drivers tab)

**State:** add `const [showAllDims, setShowAllDims] = useState(false)`

**Rendering logic:**

1. Sort dimension keys by `data.dimension_spreads` descending (defensive sort — mirrors backend order)
2. Split into `topDim` (first) and `remainingDims` (rest)
3. Always render `topDim` charts
4. Render `remainingDims` charts only when `showAllDims === true`
5. If `remainingDims.length > 0`, render expand button:
   - Collapsed: `Show {remainingDims.length} more dimension{s} ↓`
   - Expanded: `Hide extra dimensions ↑`
6. Dimensions where spread < 0.02 (2%) render with a muted note: **"No significant variation across segments"** — charts still shown so users can verify, not suppressed entirely

**Button placement:** below the top dimension's charts, above the remaining ones.

---

### What Does NOT Change

| Area | Status |
|---|---|
| `DriverBarsSection` component | Unchanged |
| `dimension_breakdowns` response shape | Unchanged |
| Bar entries controlling KPI scope | Unchanged |
| Overview tab | Unchanged |
| Trends tab | Unchanged |
| Actions tab | Unchanged |
| Recipe generator | Unchanged (existing recipes fixed automatically) |

---

## Future Enhancement (Out of Scope)

**Trends — Dimensional split:** A "More Details" expand on each Trends KPI chart showing a multi-line chart (one line per segment of the top dimension). Requires new backend data shape (`dim_time_series` grouped by period × segment) and a new multi-line chart component. Tracked for a future iteration.

---

## Thresholds

| Parameter | Value | Rationale |
|---|---|---|
| Low-spread threshold | 0.02 (2%) | Segments differ by less than 2% of mean — analytically flat |
| Max segments per bar chart | 20 (existing `.head(20)`) | Unchanged |

---

## Files Changed

| File | Change |
|---|---|
| `backend/api/routes/dashboard.py` | Replace dim-source logic, add spread computation, add `dimension_spreads` to response |
| `frontend/lib/types.ts` | Add `dimension_spreads` field to `DashboardData` |
| `frontend/app/dashboard/[recipeId]/page.tsx` | Add `showAllDims` state, ranked render, expand button |
