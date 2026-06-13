# Dashboard Enhanced View — Design Spec
**Date:** 2026-06-13  
**Status:** Approved by user  
**Scope:** `frontend/app/dashboard/[recipeId]/page.tsx` (frontend only — no backend changes)

---

## 1. Goal

Replace the current single-scroll dashboard layout with a **tabbed "Enhanced View"** that is executive-ready, insight-led, and action-oriented — while keeping the existing "Classic View" fully functional via a toggle in the header.

Target users: Ops Managers, Team Leads, Program Managers (both tactical and executive).

---

## 2. Dual-Layout Toggle

A persistent view toggle appears in the dashboard header alongside existing controls:

```
[Classic View]  [Enhanced View ✓]
```

- Stored in `localStorage` under key `bgo_dashboard_view` (`"classic"` | `"enhanced"`)
- Default is `"classic"` on first visit (no regressions for existing users)
- Switching is instant — no API call needed (both layouts consume the same `DashboardData`)
- The toggle is rendered inside the existing header bar, to the left of "Edit recipe"

When `"classic"` is active, the existing JSX renders unchanged.  
When `"enhanced"` is active, the new `EnhancedDashboard` component renders instead.

---

## 3. Enhanced View Structure

### 3.1 Header (sticky, navy background)

Preserves all existing header controls plus new ones:

| Element | Source | Notes |
|---|---|---|
| BGO AI logo | static | New — brand anchor |
| Dashboard title | `recipe.config.kpis.map(k=>k.name).join(' · ')` truncated to 40 chars, fallback `"Dashboard"` | Replaces plain "Dashboard" |
| Subtitle (date range + row count) | `data.data_quality.date_coverage` + `data.row_count` | New |
| Approved / Draft badge | `data.approved` | Existing logic, new styling |
| Date range button | UI only (no filter API change needed) | Non-functional in v1, shown disabled |
| Export button | UI only | Non-functional in v1, shown as coming soon |
| **Edit recipe** button | `router.push(/recipe/${recipeId})` | **Fully functional — identical to current** |
| View toggle | `localStorage` state | New |

### 3.2 Freshness Strip (below header, sticky)

Same data as current `FreshnessStrip` component, restyled:

- Green dot when `dq.status === "ok"`, amber dot when `"warning"`
- Shows: coverage, latest date, row count, refreshed time, warnings inline
- Sticks below the header so it's always visible

### 3.3 Tab Bar (below freshness strip, sticky)

Four tabs. Badge on Actions tab shows count of high/critical insights.

| Tab | Icon | Content |
|---|---|---|
| Overview | 📊 | Situation banner + KPI scorecards + 2-chart trend snapshot |
| Trends | 📈 | Full trend line charts with insight sidebar per KPI |
| Drivers | 🔍 | Driver bar charts, color-coded above/below average |
| Actions | ⚡ | Priority action table + root cause summary cards |

### 3.4 Filter Bar (inside each tab panel, below tab bar)

Same data source as current `FilterBar` component. Behavior identical:
- Renders only if `filterOptions` has keys
- `onChange` updates `activeFilters` state → triggers re-fetch (same `useEffect` logic)
- "Clear all ×" resets all filters
- Shows "Updating…" pulse during `filtering` state

### 3.5 Tab: Overview

**Situation Banner** (`ExecutiveBanner` component)
- Finds the highest-severity insight from `data.insights`
- Shows: severity label, headline, finding (body), three pills: driver / impact / action
- Border-left color matches severity (red = critical/high, amber = medium, green = low)
- If no insights, banner is hidden

**KPI Scorecards** (`EnhancedMetricTile` component — replaces `MetricTile`)

Each card shows (from `DashboardMetric`):
- Metric name (`metric.name`)
- Large value (`metric.value`) — color matches status
- Delta arrow + % (`metric.delta_pct`) — green for positive, red for negative
- Status badge (`metric.status`) — Good / Warning / At Risk / Neutral
- Period label (`metric.period`)
- Prior value line (`metric.prior_value`)
- **Interpretation text** — sourced from the matching `DashboardInsight.finding` for that KPI
- **Delta color inversion** — when `metric.direction === "lower_is_better"` (e.g. AHT), positive delta shows red and negative delta shows green (opposite of default)
- **Sparkline** — mini 5-point line using the last 5 periods from `data.time_series[metric.name]`
- Top border color matches status (green/amber/red/slate)

**Trend Snapshot** (2-column grid)
- Shows the first 2 KPIs from `data.time_series` as line charts
- Chart title = matching insight's `headline` (fallback: KPI name)
- Chart subtitle = matching insight's `finding` (fallback: empty)
- "View full trends →" link switches to Trends tab

### 3.6 Tab: Trends

- KPI chip filter row at top — toggle which KPIs are visible (all active by default)
- For each visible KPI with time series data:
  - Left: `TrendChart` (existing component, restyled) — insight-led title from `insight.headline`
  - Right: `InsightAside` — shows Finding / Driver / Impact / Action from matching `DashboardInsight`
  - Falls back to plain name if no insight available
- Charts render in single-column below the first "featured" KPI pair
- Average reference line rendered as dashed (existing `ReferenceLine` logic)

### 3.7 Tab: Drivers

- For each dimension in `data.dimension_breakdowns`:
  - Section title: insight-led (e.g. "CSAT by Team — Team B is 11.9 pts below average")
    - Compute top and bottom from breakdown data; format the title dynamically
  - Average reference line label above bars
  - For each breakdown row: name | bar (green if above avg, red if below) | value
  - Sorted descending by value
- Falls back gracefully if `dimension_breakdowns` is empty: shows nudge to add dimension in recipe

### 3.8 Tab: Actions

**Priority Action Table** (from `data.insights`)

Each insight row becomes one table row:
- Priority: mapped from `insight.severity` → critical / high / medium / low dot badge
- Action: `insight.action` (bold) + `insight.finding` (subdued)
- KPI Impact: KPI name chip
- Expected Impact: `insight.impact`
- Owner: static "—" placeholder in v1 (no owner model exists yet)

**Root Cause Summary Cards** (3-column grid)
- Shows up to 3 insights as cards with colored left border
- Each card: Root Cause label, `insight.headline`, `insight.driver` body text

---

## 4. Component Map

| New component | Replaces / extends | File |
|---|---|---|
| `EnhancedDashboard` | Wraps all enhanced content | `page.tsx` (inline) |
| `DashboardHeader` | Extends existing header JSX | `page.tsx` (inline) |
| `FreshnessStrip` | Existing — restyled only | `page.tsx` (inline) |
| `TabBar` + `TabPanel` | New | `page.tsx` (inline) |
| `ExecutiveBanner` | Replaces `ExecutiveHeadline` | `page.tsx` (inline) |
| `EnhancedMetricTile` | Replaces `MetricTile` | `page.tsx` (inline) |
| `SparkLine` | New (mini Chart.js-free SVG) | `page.tsx` (inline) |
| `InsightAside` | New | `page.tsx` (inline) |
| `DriverBars` | Replaces `DriverChart` (Recharts) | `page.tsx` (inline) |
| `ActionTable` | Replaces `InsightRow` | `page.tsx` (inline) |

All components stay inline in `page.tsx` — no new files. Existing components (`TrendChart`, `FilterBar`, `Spinner`, `ErrorBox`) are reused as-is or lightly restyled.

> **SparkLine**: Implemented as a tiny inline SVG path (no extra library). Takes an array of numbers, normalises to 0–100, draws a polyline. Keeps bundle size unchanged.

---

## 5. State Changes

No new API calls. All state (`recipe`, `data`, `filterOptions`, `activeFilters`, `loading`, `filtering`, `error`) is shared between Classic and Enhanced views.

New state:
```ts
const [view, setView] = useState<"classic" | "enhanced">(() =>
  (localStorage.getItem("bgo_dashboard_view") as "classic" | "enhanced") ?? "classic"
);
const [activeTab, setActiveTab] = useState<"overview" | "trends" | "drivers" | "actions">("overview");
```

`setView` also writes to `localStorage`.

---

## 6. Styling

- All styling via **Tailwind CSS 4 utility classes** (no new CSS files, no inline style blocks)
- Color palette: navy header (`slate-900`), white cards, `emerald`/`amber`/`red` for status
- Cards: `rounded-xl border border-slate-200 shadow-sm`
- Typography: existing Geist fonts via root layout
- No new dependencies

---

## 7. What Does NOT Change

- Backend (`backend/api/routes/dashboard.py`) — no changes
- `frontend/lib/api.ts` — no changes
- `frontend/lib/types.ts` — no changes
- Classic View rendering — untouched
- All existing routing, approval flow, "Edit recipe" navigation
- `AppShell.tsx` sidebar — no changes

---

## 8. Scope Boundaries (v1)

| Feature | In scope | Notes |
|---|---|---|
| Layout toggle (Classic / Enhanced) | Yes | localStorage persisted |
| Tabbed layout (4 tabs) | Yes | |
| Enhanced KPI cards with sparklines | Yes | SVG sparkline, no new lib |
| Insight-led chart titles | Yes | |
| Executive situation banner | Yes | |
| Insight aside panel (Trends tab) | Yes | |
| Color-coded driver bars | Yes | HTML/CSS, no Recharts |
| Priority action table | Yes | |
| Root cause cards | Yes | |
| Filter bar (functional) | Yes | Existing logic reused |
| Edit recipe button | Yes | Existing router.push logic |
| Approved/Draft badge | Yes | Existing logic |
| Freshness strip | Yes | Restyled |
| Date range picker (interactive) | **No** | UI only, v2 |
| Export to PDF/CSV | **No** | UI only, v2 |
| Owner assignment on actions | **No** | No data model, v2 |
| `direction` field flipping colors | Yes | `lower_is_better` inverts delta color |

---

## 9. Files Changed

| File | Change type |
|---|---|
| `frontend/app/dashboard/[recipeId]/page.tsx` | Major rewrite — adds Enhanced View alongside Classic |
