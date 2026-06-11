# Cross-file JOIN Fix + Story Sections Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two dashboard bugs — cross-file PK/FK JOIN never fires (wrong KPI calculations), and AI story sections never render (hardcoded 3-panel layout shown instead).

**Architecture:** Fix 1 chains a `sessionStorage.setItem` onto the existing `getRelationships` API call in `schema/page.tsx`, making auto-detected relationships the default even when the user skips the Confirm button. A backend warning log in `session_generator.py` makes silent fallback visible. Fix 2 wraps the existing Trend + Breakdown render blocks in a `config.sections`-conditional; old recipes without sections fall through to the unchanged flat layout.

**Tech Stack:** Next.js 16, React 19, TypeScript 5 (frontend); FastAPI, Python, `logging` stdlib (backend).

**Implementation order:** Tasks 1–2 (data layer) before Task 3 (UI layer) — fix the numbers before changing what the UI shows.

**Spec:** `docs/superpowers/specs/2026-06-11-cross-join-and-story-sections-design.md`

---

## File Map

| File | Change |
|---|---|
| `backend/services/session_generator.py` | Add warning log when multi-file + empty relationships |
| `frontend/app/session/[datasetId]/schema/page.tsx` | Chain sessionStorage write onto getRelationships .then() |
| `frontend/app/dashboard/[recipeId]/page.tsx` | Wrap Trends + Breakdown in config.sections conditional |

---

## Task 1: Backend — warning log in session_generator.py

**Files:**
- Modify: `backend/services/session_generator.py` (insert after line ~35, before line ~113)

- [ ] **Step 1: Confirm logger and insertion point**

```bash
cd backend && grep -n "logger\|# ── Build story" services/session_generator.py | head -10
```

Expected output:
```
17:logger = logging.getLogger(__name__)
113:    # ── Build story sections ──────────────────────────────────────────────
```

`logger` already exists at line 17. The warning goes just before the `# ── Build story sections` line.

- [ ] **Step 2: Add the warning**

Open `backend/services/session_generator.py`. Find the line:
```python
    # ── Build story sections ───────────────────────────────────────────────
```

Insert these two lines immediately above it:
```python
    if len(uploads) > 1 and not confirmed_relationships:
        logger.warning(
            "dataset %d: %d files but confirmed_relationships is empty — falling back to pd.concat",
            dataset_id,
            len(uploads),
        )
```

- [ ] **Step 3: Verify no syntax errors**

```bash
cd backend && python -c "import services.session_generator; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/services/session_generator.py
git commit -m "fix(compute): warn when multi-file dataset has no confirmed relationships"
```

---

## Task 2: Frontend — auto-save relationships to sessionStorage in schema/page.tsx

**Files:**
- Modify: `frontend/app/session/[datasetId]/schema/page.tsx` (lines 88–94)

- [ ] **Step 1: Locate the exact block**

Open `frontend/app/session/[datasetId]/schema/page.tsx`. Find lines 88–94:

```ts
      if (profiledCount > 1) {
        setRelLoading(true);
        api.getRelationships(Number(datasetId))
          .then(setRelationships)
          .catch(() => {})
          .finally(() => setRelLoading(false));
      }
```

- [ ] **Step 2: Apply the fix**

Replace `.then(setRelationships)` with the expanded handler:

```ts
      if (profiledCount > 1) {
        setRelLoading(true);
        api.getRelationships(Number(datasetId))
          .then((rels) => {
            setRelationships(rels);
            sessionStorage.setItem(
              `dataset_${datasetId}_relationships`,
              JSON.stringify(rels),
            );
          })
          .catch(() => {})
          .finally(() => setRelLoading(false));
      }
```

The existing `handleConfirmRelationships` at lines 132–135 already overwrites this key when the user clicks Confirm. No change needed there — it remains the user-override path.

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "schema"
```

Expected: no output (no errors for schema/page.tsx).

- [ ] **Step 4: Smoke-test manually**

1. Start the dev server: `npm run dev` (port 3000)
2. Upload two files, go through schema mapping
3. Open DevTools → Application → Session Storage
4. Confirm `dataset_<id>_relationships` key exists after the schema page loads
5. Confirm the value is a JSON array (may be `[]` if no relationships detected, or an array of objects)

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/session/[datasetId]/schema/page.tsx"
git commit -m "fix(session): auto-save detected relationships to sessionStorage on load"
```

---

## Task 3: Frontend — conditional story sections renderer in dashboard/page.tsx

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` (lines 395–509)

**Context:** `DashboardSection` and `RecipeConfig.sections?: DashboardSection[]` are already defined in `frontend/lib/types.ts` (lines 169–186). No type changes needed.

- [ ] **Step 1: Confirm types are present**

```bash
cd frontend && grep -n "DashboardSection\|sections\?" lib/types.ts
```

Expected:
```
169:export interface DashboardSection {
186:  sections?: DashboardSection[];
```

- [ ] **Step 2: Locate the two blocks to replace**

In `frontend/app/dashboard/[recipeId]/page.tsx`, find the comment markers:

```tsx
        {/* Trend charts */}
        {time_series.length > 0 && (
```
(line ~395)

and:

```tsx
        {/* Breakdown charts */}
        {breakdown.length > 0 && (
```
(line ~452)

These two blocks (lines 395–509) are what gets replaced.

- [ ] **Step 3: Replace lines 395–509 with the conditional renderer**

Delete everything from `{/* Trend charts */}` through the closing `)}` of the Breakdown charts section (inclusive). Replace with:

```tsx
        {/* Story sections (new multi-file recipes) or flat layout (legacy backward-compat) */}
        {config.sections && config.sections.length > 0 ? (
          config.sections.map((section) => {
            const sectionTimeSeries = time_series.filter((ts) =>
              section.kpis.includes(ts.kpi),
            );
            const sectionBreakdown = breakdown.filter((bk) =>
              section.kpis.includes(bk.kpi),
            );
            if (sectionTimeSeries.length === 0 && sectionBreakdown.length === 0) return null;
            return (
              <section key={section.id} className="space-y-3">
                <SectionHeader
                  title={section.title}
                  subtitle={`${section.kpis.length} metric${section.kpis.length !== 1 ? "s" : ""}`}
                />
                <div className="grid gap-5 lg:grid-cols-2">
                  {sectionTimeSeries.map((ts, i) => {
                    const kpi = kpi_summaries.find((k) => k.name === ts.kpi);
                    const formula = kpi?.formula ?? "";
                    const fmt = kpi?.format;
                    const takeaway =
                      ts.data.length > 1
                        ? (() => {
                            const first = ts.data[0]?.value ?? 0;
                            const last = ts.data[ts.data.length - 1]?.value ?? 0;
                            const diff = last - first;
                            const dir =
                              diff > 0 ? "increased" : diff < 0 ? "decreased" : "remained stable";
                            return `${ts.kpi.replace(/_/g, " ")} ${dir} from ${formatKpiValue(first, formula, fmt)} to ${formatKpiValue(last, formula, fmt)} over the period.`;
                          })()
                        : undefined;
                    return (
                      <ChartCard
                        key={ts.kpi}
                        title={ts.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        subtitle={`${config.granularity} · ${ts.data.length} periods`}
                        takeaway={takeaway}
                      >
                        {ts.data.length === 0 ? (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            No time series data. Try switching to Daily or Weekly granularity.
                          </p>
                        ) : ts.data.length === 1 ? (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            Only 1 period of data — switch to <strong>Daily</strong> or{" "}
                            <strong>Weekly</strong> for a trend view.
                          </p>
                        ) : (
                          <ChartErrorBoundary>
                            <TrendChart
                              ts={ts}
                              formula={formula}
                              fmt={fmt}
                              color={COLORS[i % COLORS.length]}
                              zoom={getZoom(ts.kpi, ts.data.length)}
                              onZoomIn={() => zoomIn(ts.kpi, ts.data.length)}
                              onZoomOut={() => zoomOut(ts.kpi, ts.data.length)}
                              onResetZoom={() => resetZoom(ts.kpi)}
                              onBrushChange={(start, end) =>
                                setZoomState((z) => ({ ...z, [ts.kpi]: { start, end } }))
                              }
                            />
                          </ChartErrorBoundary>
                        )}
                      </ChartCard>
                    );
                  })}
                  {sectionBreakdown.map((bk, i) => {
                    const kpi = kpi_summaries.find((k) => k.name === bk.kpi);
                    const formula = kpi?.formula ?? "";
                    const top = bk.data[0];
                    const takeaway = top
                      ? `Top performer: ${top.label} at ${formatKpiValue(top.value, formula)}.`
                      : undefined;
                    return (
                      <ChartCard
                        key={`${bk.kpi}-${bk.dimension}`}
                        title={`${bk.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} by ${bk.dimension}`}
                        subtitle={`${bk.data.length} groups`}
                        takeaway={takeaway}
                      >
                        {bk.data.length > 0 ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart
                              data={bk.data.map((d) => ({
                                ...d,
                                value: Number.isFinite(d.value) ? d.value : 0,
                              }))}
                              margin={{ top: 4, right: 8, left: 0, bottom: 36 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                angle={-30}
                                textAnchor="end"
                                interval={0}
                              />
                              <YAxis
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v) => formatAxisValue(v, formula)}
                              />
                              <Tooltip formatter={(v: unknown) => formatKpiValue(v as number, formula)} />
                              <Bar
                                dataKey="value"
                                fill={COLORS[i % COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={40}
                                isAnimationActive={false}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            No breakdown data available.
                          </p>
                        )}
                      </ChartCard>
                    );
                  })}
                </div>
              </section>
            );
          })
        ) : (
          <>
            {/* Flat layout — backward compat for single-file / legacy recipes without sections */}
            {time_series.length > 0 && (
              <section className="space-y-3">
                <SectionHeader title="Trends Over Time" subtitle={`${config.granularity} granularity`} />
                <div className="grid gap-5 lg:grid-cols-2">
                  {time_series.map((ts, i) => {
                    const kpi = kpi_summaries.find((k) => k.name === ts.kpi);
                    const formula = kpi?.formula ?? "";
                    const fmt = kpi?.format;
                    const takeaway =
                      ts.data.length > 1
                        ? (() => {
                            const first = ts.data[0]?.value ?? 0;
                            const last = ts.data[ts.data.length - 1]?.value ?? 0;
                            const diff = last - first;
                            const dir =
                              diff > 0 ? "increased" : diff < 0 ? "decreased" : "remained stable";
                            return `${ts.kpi.replace(/_/g, " ")} ${dir} from ${formatKpiValue(first, formula, fmt)} to ${formatKpiValue(last, formula, fmt)} over the period.`;
                          })()
                        : undefined;
                    return (
                      <ChartCard
                        key={ts.kpi}
                        title={ts.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        subtitle={`${config.granularity} · ${ts.data.length} periods`}
                        takeaway={takeaway}
                      >
                        {ts.data.length === 0 ? (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            No time series data. Try switching to Daily or Weekly granularity.
                          </p>
                        ) : ts.data.length === 1 ? (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            Only 1 period of data — switch to <strong>Daily</strong> or{" "}
                            <strong>Weekly</strong> for a trend view.
                          </p>
                        ) : (
                          <ChartErrorBoundary>
                            <TrendChart
                              ts={ts}
                              formula={formula}
                              fmt={fmt}
                              color={COLORS[i % COLORS.length]}
                              zoom={getZoom(ts.kpi, ts.data.length)}
                              onZoomIn={() => zoomIn(ts.kpi, ts.data.length)}
                              onZoomOut={() => zoomOut(ts.kpi, ts.data.length)}
                              onResetZoom={() => resetZoom(ts.kpi)}
                              onBrushChange={(start, end) =>
                                setZoomState((z) => ({ ...z, [ts.kpi]: { start, end } }))
                              }
                            />
                          </ChartErrorBoundary>
                        )}
                      </ChartCard>
                    );
                  })}
                </div>
              </section>
            )}
            {breakdown.length > 0 && (
              <section className="space-y-3">
                <SectionHeader
                  title={
                    breakdown.every((b) => b.dimension === breakdown[0]?.dimension)
                      ? `Breakdown by ${breakdown[0]?.dimension?.replace(/_/g, " ")}`
                      : "Breakdown Analysis"
                  }
                  subtitle="Comparison across dimension values"
                />
                <div className="grid gap-5 lg:grid-cols-2">
                  {breakdown.map((bk, i) => {
                    const kpi = kpi_summaries.find((k) => k.name === bk.kpi);
                    const formula = kpi?.formula ?? "";
                    const top = bk.data[0];
                    const takeaway = top
                      ? `Top performer: ${top.label} at ${formatKpiValue(top.value, formula)}.`
                      : undefined;
                    return (
                      <ChartCard
                        key={bk.kpi}
                        title={`${bk.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} by ${bk.dimension}`}
                        subtitle={`${bk.data.length} groups`}
                        takeaway={takeaway}
                      >
                        {bk.data.length > 0 ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart
                              data={bk.data.map((d) => ({
                                ...d,
                                value: Number.isFinite(d.value) ? d.value : 0,
                              }))}
                              margin={{ top: 4, right: 8, left: 0, bottom: 36 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                angle={-30}
                                textAnchor="end"
                                interval={0}
                              />
                              <YAxis
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v) => formatAxisValue(v, formula)}
                              />
                              <Tooltip formatter={(v: unknown) => formatKpiValue(v as number, formula)} />
                              <Bar
                                dataKey="value"
                                fill={COLORS[i % COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={40}
                                isAnimationActive={false}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-sm text-gray-400 py-8 text-center">
                            No breakdown data available.
                          </p>
                        )}
                      </ChartCard>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
```

- [ ] **Step 4: Verify TypeScript compiles clean**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "dashboard"
```

Expected: no output (no errors).

- [ ] **Step 5: Smoke-test manually — legacy recipe (flat layout)**

1. Open a dashboard for a recipe generated before this fix (no `sections` in config)
2. Confirm the page still shows "Trends Over Time" and "Breakdown Analysis" section headers
3. Confirm KPI scorecards still appear at top

- [ ] **Step 6: Smoke-test manually — new multi-file recipe (sections layout)**

1. Upload two files, complete all steps through Dimensions, click Generate
2. Open the resulting dashboard
3. Confirm section headers match the AI-generated section titles (e.g. "Performance Overview", "Breakdown Analysis")
4. Confirm each section only shows charts for its assigned KPIs
5. Confirm KPI scorecards still appear at top unchanged

- [ ] **Step 7: Commit**

```bash
git add "frontend/app/dashboard/[recipeId]/page.tsx"
git commit -m "feat(dashboard): render AI story sections when config.sections present, fallback to flat layout for legacy recipes"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Backend warning log — Task 1
- ✅ Auto-save relationships to sessionStorage on auto-load (not just on Confirm) — Task 2
- ✅ `handleConfirmRelationships` left unchanged — Task 2 Step 2 (explicitly noted)
- ✅ Conditional sections renderer — Task 3
- ✅ Backward compat else-branch for old recipes — Task 3 Step 3 (flat layout preserved verbatim)
- ✅ Implementation order (Tasks 1+2 before Task 3) — noted in header

**Placeholder scan:** None found. Every step has exact code.

**Type consistency:**
- `section.id`, `section.title`, `section.kpis` — matches `DashboardSection` interface (types.ts:169–172)
- `ts.kpi`, `bk.kpi`, `k.name` — all `display_name` strings, confirmed aligned in design
- `key={`${bk.kpi}-${bk.dimension}`}` in sections renderer vs `key={bk.kpi}` in flat renderer — intentionally different; flat renderer guarantees unique KPI names, sections renderer is safer with composite key
- `config.granularity`, `config.sections` — both on `RecipeConfig` type (types.ts:182, 186) ✅
