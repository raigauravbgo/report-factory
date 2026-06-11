# Design: Cross-file JOIN Fix + Story Sections Rendering

**Date:** 2026-06-11
**Branch:** sourav_stagging
**Status:** Approved

---

## Problem Summary

Two confirmed bugs prevent the dashboard from working correctly for multi-file datasets.

### Bug 1 — Cross-file JOIN silently bypassed

`compute.py:_load_staging_df` only executes a PK/FK JOIN when **both** `confirmed_relationships` and `upload_table_map` are non-empty (line 45). If either is empty, all files are row-stacked with `pd.concat` — a silent fallback that produces wrong KPI calculations because cross-file columns become NaN.

**Root cause:** `dimensions/page.tsx` reads `dataset_${datasetId}_relationships` from sessionStorage (lines 94–99) to build the generate request body. `schema/page.tsx` calls `api.getRelationships()` and pipes the result directly to `setRelationships` state (line 91: `.then(setRelationships)`) but never writes to sessionStorage at that point. A `handleConfirmRelationships` function (line 132–135) does write the key — but only when the user explicitly clicks the "Confirm" button in `SchemaRelationships.tsx`. If the user skips the confirmation step and navigates forward, the key is never set and `dimensions/page.tsx` reads `[]`.

### Bug 2 — Story sections never render

`session_generator.py` correctly generates AI story sections and stores them in `ReportRecipe.config.sections`. The API returns them inside `config`. But `dashboard/[recipeId]/page.tsx` renders a hardcoded 3-panel layout (`kpi_summaries` → `time_series` → `breakdown`) with no code that reads `config.sections`. Story sections are silently ignored.

---

## Key Alignment Verification (Pre-Design Check)

All data structures use the same `display_name` string as the KPI identifier:

| Structure | Key field | Value |
|---|---|---|
| `sections[].kpis[i]` | string value | `display_name` |
| `chart_layout[].kpi` | `"kpi"` | `display_name` |
| `kpi_summaries[].name` | `"name"` | `display_name` |
| `time_series[].kpi` | `"kpi"` | `display_name` |
| `breakdown[].kpi` | `"kpi"` | `display_name` |

Frontend lookup after fix:
```ts
time_series.filter(ts => section.kpis.includes(ts.kpi))   // ts.kpi === display_name ✓
breakdown.filter(bk  => section.kpis.includes(bk.kpi))    // bk.kpi === display_name ✓
kpi_summaries.find(k => k.name === kpi_name)               // k.name === display_name ✓
```

No additional mapping required.

---

## Fix 1 — Cross-file JOIN

### Approach

Option A: fix the frontend source (the missing sessionStorage write) + add a backend warning log.

### Changes

#### `frontend/app/session/[datasetId]/schema/page.tsx`

Change line 91 from:
```ts
api.getRelationships(Number(datasetId))
  .then(setRelationships)
  .catch(() => {})
  .finally(() => setRelLoading(false));
```
To:
```ts
api.getRelationships(Number(datasetId))
  .then((rels) => {
    setRelationships(rels);
    // Auto-save all detected relationships as default so dimensions/page.tsx
    // always has a non-empty confirmed list to send even if user skips Confirm.
    sessionStorage.setItem(`dataset_${datasetId}_relationships`, JSON.stringify(rels));
  })
  .catch(() => {})
  .finally(() => setRelLoading(false));
```

The existing `handleConfirmRelationships` (line 132–135) already overwrites this key with the user's explicit selection when they click Confirm — no change needed there. This makes auto-detected relationships the default, with user confirmation as an optional override.

The `dimensions/page.tsx` generate call already reads this key correctly (lines 94–99); no change needed there.

#### `backend/services/session_generator.py`

Add a warning log after receiving `confirmed_relationships`:

```python
if len(uploads) > 1 and not confirmed_relationships:
    logger.warning(
        "dataset %d: %d files but confirmed_relationships is empty — falling back to pd.concat",
        dataset_id,
        len(uploads),
    )
```

This makes the silent fallback visible in logs without changing any behaviour.

### What does NOT change

- `compute.py` — no change; the existing JOIN logic is correct
- `session.py` route — no change; it already passes `confirmed_relationships` from the request body
- `_get_recipe_and_staging()` — confirmed working; correctly fetches all staging tables via `dataset_id`

---

## Fix 2 — Story Sections Rendering

### Approach

Option A: conditional section renderer inside the existing dashboard page. No new files. Backward compatible — old recipes without `config.sections` continue to use the current flat layout.

### Change

**`frontend/app/dashboard/[recipeId]/page.tsx`**

Keep unchanged:
- KPI Scorecards block (lines 364–378)
- Executive Insights block (lines 380–385)
- Configuration block (lines 511–527)
- New Report button

Replace the Trends Over Time (lines 395–450) and Breakdown Analysis (lines 452–509) sections with:

```tsx
{config.sections && config.sections.length > 0 ? (
  /* Section-grouped layout for new multi-file recipes */
  config.sections.map((section) => (
    <section key={section.id} className="space-y-3">
      <SectionHeader
        title={section.title}
        subtitle={`${section.kpis.length} metric${section.kpis.length !== 1 ? "s" : ""}`}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {time_series
          .filter((ts) => section.kpis.includes(ts.kpi))
          .map((ts, i) => (
            /* existing TrendChart / ChartCard render — no changes to chart code */
          ))}
        {breakdown
          .filter((bk) => section.kpis.includes(bk.kpi))
          .map((bk, i) => (
            /* existing BarChart / ChartCard render — no changes to chart code */
          ))}
      </div>
    </section>
  ))
) : (
  /* Flat layout — backward compat for single-file / legacy recipes */
  <>
    {/* existing Trends Over Time block — unchanged */}
    {/* existing Breakdown Analysis block — unchanged */}
  </>
)}
```

All chart components (`TrendChart`, `ChartErrorBoundary`, `ChartCard`, `BarChart`, `SectionHeader`) are already imported. Zero new imports needed.

### Full page structure after fix

```
FilterBar                   unchanged
KPI Scorecards              unchanged
Executive Insights          unchanged
[config.sections?]
  YES → sections.map():
          SectionHeader(section.title)
          TrendCharts filtered to section.kpis
          BarCharts filtered to section.kpis
  NO  → existing flat Trends + Breakdown blocks
Configuration               unchanged
New Report button           unchanged
```

---

## Implementation Order

Fix 1 (cross-join) first — corrects the underlying data before changing what the UI displays.
Fix 2 (sections) second — once data is correct, the new layout shows correct numbers.

---

## Files Touched

| File | Change |
|---|---|
| `frontend/app/session/[datasetId]/schema/page.tsx` | Add `sessionStorage.setItem` after relationships API call |
| `backend/services/session_generator.py` | Add warning log when multi-file + empty relationships |
| `frontend/app/dashboard/[recipeId]/page.tsx` | Wrap Trends + Breakdown in sections conditional |

---

## Out of Scope

- `chart_type` per section (kpi_card / line / bar) — sections render both trend and breakdown charts regardless. The `chart_type` hint is stored in config for potential future use.
- Migrating existing recipes — old recipes keep the flat layout via the backward-compat else branch. No DB migration needed.
- `chart_layout` from config — not used in this fix; available for future chart-type-aware rendering.
