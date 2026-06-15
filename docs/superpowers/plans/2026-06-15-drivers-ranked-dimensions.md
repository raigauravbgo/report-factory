# Drivers Ranked Dimensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Drivers tab to show all user-selected dimensions ranked by spread (analytical impact), with the top dimension always visible and remaining dimensions behind a dynamic expand button.

**Architecture:** Backend always sources dimensions from `config.dimensions` (not bar chart entries), computes a spread score per dimension after building breakdowns, sorts by spread descending, and returns a `dimension_spreads` map alongside the existing `dimension_breakdowns`. Frontend reads the spread map to sort dimensions, renders the top one by default, and expands the rest on button click.

**Tech Stack:** Python/FastAPI (backend), TypeScript/React/Tailwind (frontend)

---

## File Map

| File | Change |
|---|---|
| `backend/api/routes/dashboard.py` | Replace dim-source logic; add spread computation + sort; add `dimension_spreads` to response |
| `frontend/lib/types.ts` | Add `dimension_spreads: Record<string, number>` to `DashboardData` |
| `frontend/app/dashboard/[recipeId]/page.tsx` | Add `showAllDims` state inside `EnhancedDashboard`; replace Drivers tab render with ranked + expand logic |

---

## Task 1: Backend — Fix dimension source, compute spread, return metadata

**Files:**
- Modify: `backend/api/routes/dashboard.py:718-788`

### Context

Current code at line 718 uses `bar_entries[].group_by` as the dimension source. Recipe 2's bar entries all have `group_by: "department"` so only that dim appears. The fix: always use `config.dimensions`; keep bar entries only for KPI scoping.

### Steps

- [ ] **Step 1: Replace the dimension breakdown block (lines 718–768)**

Replace the entire block from `# Dimension breakdowns` through the closing `]` of `dimension_breakdowns[dim][kpi.name] = [...]` with:

```python
    # Dimension breakdowns
    # KPI scope: bar entries determine which KPIs appear in Drivers (unchanged)
    # Dimension scope: always use config.dimensions — the user's explicit selection
    bar_entries = [
        c for c in config.chart_layout
        if c.type == "bar" and getattr(c, "show_breakdown", True)
    ]
    if bar_entries:
        breakdown_kpi_names = {c.kpi for c in bar_entries}
    else:
        breakdown_kpi_names = {k.name for k in config.kpis}

    ordered_dims: list[str] = list(config.dimensions or [])
    breakdown_kpis = [k for k in config.kpis if k.name in breakdown_kpi_names] or config.kpis

    dimension_breakdowns: dict = {}
    for dim in ordered_dims:
        dim_in_any = dim in df.columns or any(dim in adf.columns for adf in alt_dfs.values() if not adf.empty)
        if not dim_in_any:
            continue
        dimension_breakdowns[dim] = {}
        for kpi in breakdown_kpis:
            kdf = _df_for_kpi(kpi)
            if kdf.empty or dim not in kdf.columns:
                continue
            series = _eval_kpi(kdf, kpi.resolved_formula or kpi.formula)
            if series is None or not series.notna().any():
                continue
            kdf = kdf.copy()
            kdf["__val__"] = series
            grouped = (
                kdf.groupby(dim)["__val__"]
                .mean()
                .reset_index()
                .sort_values("__val__", ascending=False)
                .head(20)
            )
            dimension_breakdowns[dim][kpi.name] = [
                {"name": str(row[dim]), "value": round(float(row["__val__"]) if pd.notna(row["__val__"]) else 0.0, 2)}
                for _, row in grouped.iterrows()
            ]

    # Compute spread per dimension: (max_segment - min_segment) / mean, averaged across KPIs
    def _spread_for_dim(kpis_data: dict) -> float:
        kpi_spreads = []
        for segments in kpis_data.values():
            values = [s["value"] for s in segments]
            if len(values) < 2:
                continue
            mean_val = sum(values) / len(values)
            if mean_val == 0:
                continue
            kpi_spreads.append((max(values) - min(values)) / mean_val)
        return sum(kpi_spreads) / len(kpi_spreads) if kpi_spreads else 0.0

    dimension_spreads: dict[str, float] = {
        dim: round(_spread_for_dim(kpis_data), 4)
        for dim, kpis_data in dimension_breakdowns.items()
    }
    dimension_breakdowns = dict(
        sorted(dimension_breakdowns.items(), key=lambda x: dimension_spreads[x[0]], reverse=True)
    )
```

- [ ] **Step 2: Add `dimension_spreads` to the return dict (line 785 area)**

In the `return { ... }` block, add `dimension_spreads` after `dimension_breakdowns`:

```python
        "dimension_breakdowns": dimension_breakdowns,
        "dimension_spreads": dimension_spreads,
        "insights": insights,
```

- [ ] **Step 3: Verify the backend starts without errors**

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Expected: server starts, no import or syntax errors.

- [ ] **Step 4: Smoke-test the endpoint**

With the backend running and recipe 2 in the DB:

```bash
curl -s http://localhost:8000/dashboard/2/data | python -m json.tool | grep -A 10 "dimension_spreads"
```

Expected: JSON block like:
```json
"dimension_spreads": {
  "pod": 0.65,
  "department": 0.42,
  "location": 0.08,
  "team_lead_supervisor": 0.01
}
```

All 4 dimensions (not just department) should appear in `dimension_breakdowns`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes/dashboard.py
git commit -m "fix: Drivers always uses config.dimensions; adds spread ranking"
```

---

## Task 2: Frontend types — Add dimension_spreads to DashboardData

**Files:**
- Modify: `frontend/lib/types.ts:305`

### Steps

- [ ] **Step 1: Add the field to `DashboardData`**

In `frontend/lib/types.ts`, find the `DashboardData` interface. After the `dimension_breakdowns` line add:

```ts
  dimension_breakdowns: Record<string, Record<string, Array<{ name: string; value: number }>>>;
  dimension_spreads: Record<string, number>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "types: add dimension_spreads to DashboardData"
```

---

## Task 3: Frontend — Ranked Drivers tab with expand button

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

### Context

The Drivers tab render lives inside `EnhancedDashboard` (a component defined in the same file). `activeTab` state is already inside `EnhancedDashboard` at line 822. Add `showAllDims` state there too — no prop threading needed.

### Steps

- [ ] **Step 1: Add `showAllDims` state to `EnhancedDashboard`**

In `EnhancedDashboard`, find:
```ts
  const [activeTab, setActiveTab] = useState<TabId>("overview");
```

Add immediately below it:
```ts
  const [showAllDims, setShowAllDims] = useState(false);
```

- [ ] **Step 2: Replace the Drivers tab render block**

Find the existing Drivers block (lines 970–1003):
```tsx
        {activeTab === "drivers" && (
          <div>
            {Object.keys(data.dimension_breakdowns).length === 0 ? (
              ...existing empty state...
            ) : (
              <div className="grid gap-3 lg:grid-cols-2 items-start">
                {Object.entries(data.dimension_breakdowns).flatMap(([dim, kpis]) =>
                  Object.entries(kpis).map(([kpiName, breakdown]) => (
                    <DriverBarsSection ... />
                  )),
                )}
              </div>
            )}
          </div>
        )}
```

Replace the entire block with:

```tsx
        {activeTab === "drivers" && (
          <div>
            {Object.keys(data.dimension_breakdowns).length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
                <div className="text-sm font-semibold text-amber-800 mb-1">
                  No driver data available
                </div>
                <div className="text-xs text-amber-600 mb-4">
                  Add a dimension to your recipe to see breakdowns by team, location, or product.
                </div>
                <button
                  onClick={onEditRecipe}
                  className="text-xs font-medium px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  Edit recipe
                </button>
              </div>
            ) : (() => {
              const sortedDims = Object.keys(data.dimension_breakdowns).sort(
                (a, b) => (data.dimension_spreads?.[b] ?? 0) - (data.dimension_spreads?.[a] ?? 0),
              );
              const [topDim, ...remainingDims] = sortedDims;

              const renderDimSection = (dim: string) => (
                <div key={dim}>
                  {(data.dimension_spreads?.[dim] ?? 0) < 0.02 && (
                    <p className="text-xs text-slate-400 italic mb-2 px-1">
                      No significant variation across segments for{" "}
                      <span className="font-medium">{dim}</span>
                    </p>
                  )}
                  <div className="grid gap-3 lg:grid-cols-2 items-start">
                    {Object.entries(data.dimension_breakdowns[dim]).map(([kpiName, breakdown]) => (
                      <DriverBarsSection
                        key={`${dim}-${kpiName}`}
                        dim={dim}
                        kpiName={kpiName}
                        breakdown={breakdown}
                        insight={insightFor(kpiName)}
                      />
                    ))}
                  </div>
                </div>
              );

              return (
                <div className="space-y-6">
                  {renderDimSection(topDim)}
                  {remainingDims.length > 0 && (
                    <>
                      <div className="flex justify-center">
                        <button
                          onClick={() => setShowAllDims((v) => !v)}
                          className="text-xs font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          {showAllDims
                            ? "Hide extra dimensions ↑"
                            : `Show ${remainingDims.length} more dimension${remainingDims.length === 1 ? "" : "s"} ↓`}
                        </button>
                      </div>
                      {showAllDims && (
                        <div className="space-y-6">
                          {remainingDims.map((dim) => renderDimSection(dim))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Start the app and verify in the browser**

```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Open `http://localhost:3000/dashboard/2` → navigate to Drivers tab.

Verify:
- Top-ranked dimension charts are visible immediately (not department necessarily — whichever has highest spread)
- Button reads "Show 3 more dimensions ↓" (for 4-dim recipe)
- Clicking button expands the remaining 3 dimensions
- Button label flips to "Hide extra dimensions ↑"
- Clicking again collapses them
- Dims with spread < 0.02 show the muted italic note above their charts

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat: Drivers tab shows all dims ranked by spread with expand button"
```

---

## Self-Review Checklist

| Spec requirement | Covered by |
|---|---|
| Always use `config.dimensions` as source | Task 1 Step 1 |
| Remove `[:3]` cap | Task 1 Step 1 (the cap is gone; `ordered_dims = list(config.dimensions or [])`) |
| Compute spread per dimension | Task 1 Step 1 (`_spread_for_dim`) |
| Sort dimensions by spread descending | Task 1 Step 1 (`sorted(..., reverse=True)`) |
| `dimension_spreads` in API response | Task 1 Step 2 |
| `dimension_spreads` TypeScript type | Task 2 Step 1 |
| Top dimension always visible | Task 3 Step 2 (`renderDimSection(topDim)`) |
| Expand button with dynamic count | Task 3 Step 2 (`Show ${remainingDims.length} more...`) |
| No hardcoded numbers | Task 3 Step 2 — all counts derived from `sortedDims` |
| Low-spread muted note (< 2%) | Task 3 Step 2 (`< 0.02` check) |
| Existing recipes fixed (no migration) | Task 1 — reads from `config.dimensions` already stored in DB |
| Overview/Trends untouched | Not in any task — correct |
