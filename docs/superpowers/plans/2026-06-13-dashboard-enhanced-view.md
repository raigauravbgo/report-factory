# Dashboard Enhanced View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Enhanced View" toggle to the dashboard that renders a 4-tab executive layout (Overview, Trends, Drivers, Actions) while keeping the existing Classic View fully functional.

**Architecture:** A `view` state (`"classic" | "enhanced"`) stored in `localStorage` controls which render path fires. Classic view is the existing JSX — untouched. Enhanced view renders a new `EnhancedDashboard` component that shares all existing data-fetching state (`data`, `filterOptions`, `activeFilters`, `filtering`) via props. All new components are defined inline in the same file.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Recharts 3 (already installed). No new dependencies.

---

## File Map

| File | Change |
|---|---|
| `frontend/app/dashboard/[recipeId]/page.tsx` | Major addition — ~550 lines added, existing ~467 lines kept intact |

Verification command (no test infrastructure in project):
```bash
cd frontend && npx tsc --noEmit && npm run lint
```
Build check:
```bash
cd frontend && npm run build
```

---

## Task 1: Add constants, types, and pure helper functions

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` — add after the existing `SEV_CFG` block (after line 34)

- [ ] **Step 1: Add new constants and type after the existing `SEV_CFG` constant**

Insert the following block immediately after the closing `};` of `SEV_CFG` (after line 34 of the current file):

```typescript
// ── Enhanced View — types & constants ─────────────────────────────────────

type TabId = "overview" | "trends" | "drivers" | "actions";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "trends",   label: "Trends",   icon: "📈" },
  { id: "drivers",  label: "Drivers",  icon: "🔍" },
  { id: "actions",  label: "Actions",  icon: "⚡" },
];

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const STATUS_TOP: Record<string, string> = {
  good:    "border-t-emerald-500",
  warning: "border-t-amber-500",
  risk:    "border-t-red-500",
  neutral: "border-t-slate-300",
};

const STATUS_VAL2: Record<string, string> = {
  good:    "text-emerald-700",
  warning: "text-amber-700",
  risk:    "text-red-700",
  neutral: "text-slate-800",
};

const STATUS_BADGE2: Record<string, string> = {
  good:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  risk:    "bg-red-50 text-red-700 ring-red-200",
  neutral: "bg-slate-100 text-slate-500 ring-slate-200",
};

const STATUS_INTERP: Record<string, string> = {
  good:    "bg-emerald-50 border-l-emerald-300",
  warning: "bg-amber-50 border-l-amber-300",
  risk:    "bg-red-50 border-l-red-300",
  neutral: "bg-slate-50 border-l-slate-200",
};

const SPARK_COLOR: Record<string, string> = {
  good: "#16a34a", warning: "#d97706", risk: "#dc2626", neutral: "#94a3b8",
};

const SEV_BANNER: Record<string, { border: string; label: string; icon: string }> = {
  critical: { border: "border-l-red-600",    label: "text-red-600",    icon: "🔴" },
  high:     { border: "border-l-red-400",    label: "text-red-500",    icon: "🟠" },
  medium:   { border: "border-l-amber-400",  label: "text-amber-600",  icon: "🟡" },
  low:      { border: "border-l-emerald-400",label: "text-emerald-600",icon: "🟢" },
};

const PRIORITY_STYLE: Record<string, { dot: string; text: string }> = {
  critical: { dot: "bg-red-600",    text: "text-red-600"    },
  high:     { dot: "bg-orange-500", text: "text-orange-600" },
  medium:   { dot: "bg-amber-500",  text: "text-amber-700"  },
  low:      { dot: "bg-slate-400",  text: "text-slate-500"  },
};
```

- [ ] **Step 2: Add helper functions immediately after the constants block from Step 1**

```typescript
// ── Enhanced View — pure helpers ──────────────────────────────────────────

function getInsightForKpi(
  insights: DashboardInsight[],
  kpiName: string,
): DashboardInsight | undefined {
  return insights.find((ins) => ins.headline.startsWith(kpiName));
}

function buildSparkPath(values: number[]): string {
  if (values.length < 2) return "";
  const W = 80, H = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = ((i / (values.length - 1)) * W).toFixed(1);
      const y = (H - ((v - min) / range) * (H - 4) - 2).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}

function deltaClass(delta: number | null, direction: string): string {
  if (delta === null) return "text-slate-400";
  const up = delta >= 0;
  const good = direction === "lower_is_better" ? !up : up;
  return good ? "text-emerald-600" : "text-red-600";
}

function dashboardTitle(kpis: Array<{ name: string }>): string {
  if (!kpis.length) return "Dashboard";
  const s = kpis.map((k) => k.name).join(" · ");
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. If errors appear they will be about unused variables — fix by checking the exact message and adjusting the constant names if there are collisions with existing code.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add enhanced view constants and helper functions"
```

---

## Task 2: SparkLine, EnhancedSectionHeading, and TabBar components

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` — add new components after the helper functions from Task 1

- [ ] **Step 1: Add SparkLine, EnhancedSectionHeading, and TabBar after the helper functions block**

```tsx
// ── SparkLine ─────────────────────────────────────────────────────────────

function SparkLine({ values, color }: { values: number[]; color: string }) {
  const pts = buildSparkPath(values);
  if (!pts) return null;
  return (
    <svg viewBox="0 0 80 24" className="w-full h-7 mt-2" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── EnhancedSectionHeading ────────────────────────────────────────────────

function EnhancedSectionHeading({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
        {children}
      </h2>
      <div className="flex-1 border-t border-slate-200" />
      {right}
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
  actionCount,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  actionCount: number;
}) {
  return (
    <div className="bg-white border-b border-slate-200 flex overflow-x-auto">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0
            ${
              active === t.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
        >
          <span>{t.icon}</span>
          {t.label}
          {t.id === "actions" && actionCount > 0 && (
            <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
              {actionCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add SparkLine, EnhancedSectionHeading, and TabBar components"
```

---

## Task 3: Add view toggle to DashboardPage and Classic View header

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` — modify `DashboardPage`

- [ ] **Step 1: Add `view` state to DashboardPage**

In `DashboardPage`, after the existing `const [error, setError] = useState<string | null>(null);` line, add:

```typescript
const [view, setView] = useState<"classic" | "enhanced">("classic");

useEffect(() => {
  const stored = localStorage.getItem("bgo_dashboard_view") as "classic" | "enhanced" | null;
  if (stored === "enhanced" || stored === "classic") setView(stored);
}, []);

const handleViewChange = (v: "classic" | "enhanced") => {
  setView(v);
  localStorage.setItem("bgo_dashboard_view", v);
};
```

- [ ] **Step 2: Add view toggle to Classic View header**

In the Classic View's header div (the one that currently renders `<h1 className="text-lg font-semibold...">Dashboard</h1>`), replace the header div with:

```tsx
{/* Header */}
<div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
  <h1 className="text-lg font-semibold text-slate-900 tracking-tight">Dashboard</h1>
  <div className="flex items-center gap-2">
    {/* View toggle */}
    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
      {(["classic", "enhanced"] as const).map((v) => (
        <button
          key={v}
          onClick={() => handleViewChange(v)}
          className={`px-3 py-1.5 font-medium capitalize transition-colors ${
            view === v
              ? "bg-blue-600 text-white"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          {v === "classic" ? "Classic" : "Enhanced ✦"}
        </button>
      ))}
    </div>
    <span
      className={`text-[11px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset
        ${data.approved
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-amber-200"}`}
    >
      {data.approved ? "Approved" : "Draft"}
    </span>
    <button
      onClick={() => router.push(`/recipe/${recipeId}`)}
      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 shadow-sm transition-colors"
    >
      Edit recipe
    </button>
  </div>
</div>
```

- [ ] **Step 3: Add Enhanced View conditional return before Classic View render**

In `DashboardPage`, before the Classic View's `return (` statement, add:

```tsx
if (view === "enhanced") {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Enhanced View — coming in next tasks
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles and lint passes**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Manual browser check**

Start the dev server: `cd frontend && npm run dev`

Navigate to any dashboard URL (e.g. `http://localhost:3000/dashboard/1`).

Verify:
1. Classic View renders exactly as before
2. "Classic / Enhanced ✦" toggle appears in the header
3. Clicking "Enhanced ✦" shows the placeholder text
4. Refreshing the page with Enhanced selected restores Enhanced view (localStorage)
5. Clicking "Classic" goes back to Classic view

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add classic/enhanced view toggle with localStorage persistence"
```

---

## Task 4: EnhancedHeader, EnhancedFreshnessStrip, and EnhancedDashboard skeleton

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` — add components after TabBar

- [ ] **Step 1: Add EnhancedHeader component**

Add after the `TabBar` component:

```tsx
// ── EnhancedHeader ────────────────────────────────────────────────────────

function EnhancedHeader({
  recipe,
  data,
  view,
  onViewChange,
  onEditRecipe,
}: {
  recipe: RecipeResponse;
  data: DashboardData;
  view: "classic" | "enhanced";
  onViewChange: (v: "classic" | "enhanced") => void;
  onEditRecipe: () => void;
}) {
  const title = dashboardTitle(recipe.config.kpis);
  const subtitle = [
    data.data_quality?.date_coverage,
    `${data.row_count.toLocaleString()} records`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-[13px] font-bold tracking-widest text-blue-300 uppercase shrink-0">
          BGO AI
        </span>
        <div className="w-px h-6 bg-slate-700 shrink-0" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight truncate">{title}</div>
          {subtitle && (
            <div className="text-[11px] text-slate-400 leading-tight truncate">{subtitle}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            data.approved
              ? "bg-emerald-950 text-emerald-400 border-emerald-700"
              : "bg-amber-950 text-amber-400 border-amber-700"
          }`}
        >
          {data.approved ? "✓ Approved" : "Draft"}
        </span>
        <div className="flex rounded-lg border border-slate-600 overflow-hidden text-xs">
          {(["classic", "enhanced"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                view === v
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {v === "classic" ? "Classic" : "Enhanced ✦"}
            </button>
          ))}
        </div>
        <button
          onClick={onEditRecipe}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          ✏ Edit recipe
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add EnhancedFreshnessStrip component**

Add immediately after `EnhancedHeader`:

```tsx
// ── EnhancedFreshnessStrip ────────────────────────────────────────────────

function EnhancedFreshnessStrip({
  dq,
  generatedAt,
  rowCount,
}: {
  dq: DataQuality;
  generatedAt: string;
  rowCount: number;
}) {
  const time = new Date(generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const items = [
    dq.date_coverage && `Coverage: ${dq.date_coverage}`,
    dq.most_recent_date && `Latest: ${dq.most_recent_date}`,
    `${rowCount.toLocaleString()} rows`,
    `Refreshed ${time}`,
  ].filter(Boolean) as string[];
  const ok = dq.status === "ok";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 px-6 py-2 text-[11px] border-b ${
        ok
          ? "bg-white text-slate-400 border-slate-200"
          : "bg-amber-50 text-amber-700 border-amber-200"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {items.map((s) => (
        <span key={s}>{s}</span>
      ))}
      {dq.warnings.map((w, i) => (
        <span key={i} className="font-semibold">
          ⚠ {w}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add EnhancedDashboard skeleton with empty tab panels**

Add immediately after `EnhancedFreshnessStrip`:

```tsx
// ── EnhancedDashboard ─────────────────────────────────────────────────────

interface EnhancedDashboardProps {
  recipe: RecipeResponse;
  data: DashboardData;
  filterOptions: Record<string, string[]>;
  activeFilters: Record<string, string>;
  filtering: boolean;
  view: "classic" | "enhanced";
  onViewChange: (v: "classic" | "enhanced") => void;
  onFilterChange: (col: string, val: string) => void;
  onClearFilters: () => void;
  onEditRecipe: () => void;
}

function EnhancedDashboard(props: EnhancedDashboardProps) {
  const {
    recipe, data, filterOptions, activeFilters, filtering,
    view, onViewChange, onFilterChange, onClearFilters, onEditRecipe,
  } = props;

  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const insightFor = (kpiName: string) => getInsightForKpi(data.insights, kpiName);
  const sparkFor = (kpiName: string): number[] =>
    (data.time_series[kpiName] ?? []).slice(-5).map((p) => p.value);
  const highSeverityCount = data.insights.filter(
    (i) => i.severity === "critical" || i.severity === "high",
  ).length;

  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Sticky header block */}
      <div className="sticky top-0 z-40">
        <EnhancedHeader
          recipe={recipe}
          data={data}
          view={view}
          onViewChange={onViewChange}
          onEditRecipe={onEditRecipe}
        />
        {data.data_quality && (
          <EnhancedFreshnessStrip
            dq={data.data_quality}
            generatedAt={data.generated_at}
            rowCount={data.row_count}
          />
        )}
        <TabBar active={activeTab} onChange={setActiveTab} actionCount={highSeverityCount} />
      </div>

      {/* Page content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Filter bar — all tabs */}
        {Object.keys(filterOptions).length > 0 && (
          <div className="mb-6">
            <FilterBar
              options={filterOptions}
              active={activeFilters}
              onChange={onFilterChange}
              loading={filtering}
            />
          </div>
        )}

        {activeTab === "overview"  && <div className="text-slate-400 text-sm py-8 text-center">Overview — Task 5</div>}
        {activeTab === "trends"    && <div className="text-slate-400 text-sm py-8 text-center">Trends — Task 7</div>}
        {activeTab === "drivers"   && <div className="text-slate-400 text-sm py-8 text-center">Drivers — Task 8</div>}
        {activeTab === "actions"   && <div className="text-slate-400 text-sm py-8 text-center">Actions — Task 9</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire EnhancedDashboard into DashboardPage**

Replace the temporary placeholder `if (view === "enhanced") { return ... }` block from Task 3 Step 3 with:

```tsx
if (view === "enhanced") {
  return (
    <EnhancedDashboard
      recipe={recipe}
      data={data}
      filterOptions={filterOptions}
      activeFilters={activeFilters}
      filtering={filtering}
      view={view}
      onViewChange={handleViewChange}
      onFilterChange={(col, val) =>
        setActiveFilters((prev) => ({ ...prev, [col]: val }))
      }
      onClearFilters={() =>
        Object.keys(filterOptions).forEach((col) =>
          setActiveFilters((prev) => ({ ...prev, [col]: "" }))
        )
      }
      onEditRecipe={() => router.push(`/recipe/${recipeId}`)}
    />
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. The `insightFor` and `sparkFor` variables in `EnhancedDashboard` will show "declared but never used" lint warnings — that is fine, they will be used in later tasks.

- [ ] **Step 6: Manual browser check**

Navigate to a dashboard URL and click "Enhanced ✦":
1. Navy header shows BGO AI logo, title from KPI names, Approved/Draft badge, toggle, Edit recipe button
2. Freshness strip appears below header
3. Four tabs appear: 📊 Overview, 📈 Trends, 🔍 Drivers, ⚡ Actions
4. Filter dropdowns render (if recipe has filter columns)
5. Each tab shows placeholder text
6. "Edit recipe" button navigates to `/recipe/{recipeId}`
7. Toggle back to "Classic" shows Classic View

- [ ] **Step 7: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add EnhancedDashboard skeleton with header, freshness strip, and tab bar"
```

---

## Task 5: ExecutiveBanner + EnhancedMetricTile — Overview tab KPI section

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

- [ ] **Step 1: Add ExecutiveBanner component**

Add before the `EnhancedDashboard` component:

```tsx
// ── ExecutiveBanner ───────────────────────────────────────────────────────

function ExecutiveBanner({ insights }: { insights: DashboardInsight[] }) {
  if (!insights.length) return null;
  const top =
    insights.find((i) => i.severity === "critical" || i.severity === "high") ?? insights[0];
  const cfg = SEV_BANNER[top.severity] ?? SEV_BANNER.low;
  return (
    <div
      className={`border-l-4 bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 mb-6 ${cfg.border}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${cfg.label}`}>
            {top.severity}
          </div>
          <div className="text-base font-bold text-slate-900 mb-2 leading-snug">
            {top.headline}
          </div>
          <div className="text-sm text-slate-600 leading-relaxed mb-3">{top.finding}</div>
          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-amber-50 text-amber-800">
              Driver: {top.driver}
            </span>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-50 text-red-800">
              Impact: {top.impact}
            </span>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-blue-50 text-blue-800">
              Action: {top.action}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add EnhancedMetricTile component**

Add immediately after `ExecutiveBanner`:

```tsx
// ── EnhancedMetricTile ────────────────────────────────────────────────────

function EnhancedMetricTile({
  metric,
  insight,
  sparkValues,
}: {
  metric: DashboardMetric;
  insight?: DashboardInsight;
  sparkValues: number[];
}) {
  const hasDelta = metric.delta !== null && metric.delta_pct !== null;
  const up = (metric.delta ?? 0) >= 0;
  const dColor = deltaClass(metric.delta, metric.direction);
  const topBorder = STATUS_TOP[metric.status] ?? STATUS_TOP.neutral;
  const valColor  = STATUS_VAL2[metric.status]  ?? STATUS_VAL2.neutral;
  const badgeCls  = STATUS_BADGE2[metric.status] ?? STATUS_BADGE2.neutral;
  const interpCls = STATUS_INTERP[metric.status] ?? STATUS_INTERP.neutral;
  const sparkCol  = SPARK_COLOR[metric.status]   ?? SPARK_COLOR.neutral;
  const statusLabel =
    metric.status === "risk" ? "At Risk"
    : metric.status.charAt(0).toUpperCase() + metric.status.slice(1);

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-t-4 ${topBorder} hover:shadow-md transition-shadow`}
    >
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 truncate">
        {metric.name}
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-3xl font-extrabold tabular-nums leading-none ${valColor}`}>
          {metric.value % 1 === 0 ? metric.value : metric.value.toFixed(1)}
        </span>
        {hasDelta && (
          <span className={`text-sm font-bold ${dColor}`}>
            {up ? "▲" : "▼"} {Math.abs(metric.delta_pct!).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ring-inset capitalize ${badgeCls}`}
        >
          {statusLabel}
        </span>
        <span className="text-[10px] text-slate-400">{metric.period ?? ""}</span>
      </div>
      {metric.prior_value !== null && (
        <div className="text-[11px] text-slate-400 mb-2">
          Prior: {metric.prior_value.toFixed(1)}
        </div>
      )}
      {insight && (
        <div
          className={`text-[11px] leading-relaxed p-2.5 rounded-lg border-l-4 ${interpCls}`}
        >
          {insight.finding}
        </div>
      )}
      {sparkValues.length >= 2 && <SparkLine values={sparkValues} color={sparkCol} />}
      <div className="text-[10px] text-slate-300 mt-1">
        {metric.count.toLocaleString()} records
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire ExecutiveBanner and EnhancedMetricTile into the Overview tab**

In `EnhancedDashboard`, replace:
```tsx
{activeTab === "overview"  && <div className="text-slate-400 text-sm py-8 text-center">Overview — Task 5</div>}
```

With:

```tsx
{activeTab === "overview" && (
  <div>
    {/* Situation banner */}
    <ExecutiveBanner insights={data.insights} />

    {/* KPI Scorecards */}
    {data.metrics.length > 0 && (
      <section className="mb-8">
        <EnhancedSectionHeading>KPI Scorecards</EnhancedSectionHeading>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {data.metrics.map((m) => (
            <EnhancedMetricTile
              key={m.id}
              metric={m}
              insight={insightFor(m.name)}
              sparkValues={sparkFor(m.name)}
            />
          ))}
        </div>
      </section>
    )}

    {/* Trend snapshot placeholder — Task 6 */}
    <div className="text-slate-400 text-sm py-4 text-center">Trend snapshot — Task 6</div>
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Manual browser check**

In Enhanced View → Overview tab:
1. Red/amber/green banner appears at top showing the highest-severity insight (headline, finding, three pills)
2. KPI cards render in a 4-column grid
3. Each card shows: metric name, large value, delta arrow with %, status badge, prior value, interpretation text, sparkline, record count
4. AHT-style "lower_is_better" metrics show red delta for increases (verify by checking `direction` field in `data.metrics`)
5. Sparklines render as small SVG lines — trending up or down correctly

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add ExecutiveBanner and EnhancedMetricTile with sparklines"
```

---

## Task 6: Overview trend snapshot section

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

- [ ] **Step 1: Replace the trend snapshot placeholder in the Overview tab**

In `EnhancedDashboard`, replace:
```tsx
{/* Trend snapshot placeholder — Task 6 */}
<div className="text-slate-400 text-sm py-4 text-center">Trend snapshot — Task 6</div>
```

With:

```tsx
{/* Trend snapshot */}
{Object.keys(data.time_series).length > 0 && (
  <section>
    <EnhancedSectionHeading
      right={
        <button
          onClick={() => setActiveTab("trends")}
          className="text-xs text-blue-600 hover:underline shrink-0"
        >
          View full trends →
        </button>
      }
    >
      Trend Snapshot
    </EnhancedSectionHeading>
    <div className="grid gap-4 lg:grid-cols-2">
      {Object.entries(data.time_series)
        .slice(0, 2)
        .map(([kpiName, series], i) => {
          const ins = insightFor(kpiName);
          const avg = series.length
            ? series.reduce((s, p) => s + p.value, 0) / series.length
            : null;
          return (
            <div
              key={kpiName}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
            >
              <div className="text-sm font-bold text-slate-900 mb-1 leading-snug">
                {ins?.headline ?? kpiName}
              </div>
              {ins && (
                <div className="text-xs text-slate-500 mb-4 leading-relaxed">
                  {ins.finding}
                </div>
              )}
              <ResponsiveContainer width="100%" height={150}>
                <LineChart
                  data={series}
                  margin={{ top: 6, right: 6, bottom: 0, left: -8 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 1px 4px rgba(0,0,0,.06)",
                    }}
                    itemStyle={{ color: "#334155" }}
                  />
                  {avg !== null && (
                    <ReferenceLine
                      y={avg}
                      stroke="#cbd5e1"
                      strokeDasharray="3 3"
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })}
    </div>
  </section>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Manual browser check**

In Enhanced View → Overview tab:
1. "Trend Snapshot" section appears below KPI cards
2. Shows at most 2 charts in a 2-column grid
3. Each chart title is the insight headline (not just the KPI name)
4. "View full trends →" link switches to the Trends tab
5. Dashed average reference line renders on each chart

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add insight-led trend snapshot to Overview tab"
```

---

## Task 7: InsightAside component and full Trends tab

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

- [ ] **Step 1: Add InsightAside component**

Add before `ExecutiveBanner`:

```tsx
// ── InsightAside ──────────────────────────────────────────────────────────

function InsightAside({ insight }: { insight: DashboardInsight }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 flex flex-col gap-3 border border-slate-200">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        📌 Insight
      </div>
      {(["finding", "driver", "impact", "action"] as const).map((key) => (
        <div key={key} className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {key}
          </span>
          <span className="text-xs text-slate-700 leading-relaxed">{insight[key]}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire full Trends tab in EnhancedDashboard**

Replace:
```tsx
{activeTab === "trends"    && <div className="text-slate-400 text-sm py-8 text-center">Trends — Task 7</div>}
```

With:

```tsx
{activeTab === "trends" && (
  <div>
    {Object.keys(data.time_series).length === 0 ? (
      <div className="text-center py-16 text-slate-400 text-sm">
        No trend data available. Ensure your recipe includes a date column and at least two time periods.
      </div>
    ) : (
      Object.entries(data.time_series).map(([kpiName, series], i) => {
        const ins = insightFor(kpiName);
        const avg = series.length
          ? series.reduce((s, p) => s + p.value, 0) / series.length
          : null;
        return (
          <div
            key={kpiName}
            className={`grid gap-4 mb-6 ${ins ? "lg:grid-cols-[1fr_280px]" : ""}`}
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="text-sm font-bold text-slate-900 mb-1 leading-snug">
                {ins?.headline ?? kpiName}
              </div>
              {ins && (
                <div className="text-xs text-slate-500 mb-4 leading-relaxed">
                  {ins.finding}
                </div>
              )}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={series}
                  margin={{ top: 6, right: 6, bottom: 0, left: -8 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 1px 4px rgba(0,0,0,.06)",
                    }}
                    itemStyle={{ color: "#334155" }}
                  />
                  {avg !== null && (
                    <ReferenceLine y={avg} stroke="#cbd5e1" strokeDasharray="3 3" />
                  )}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {ins && <InsightAside insight={ins} />}
          </div>
        );
      })
    )}
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Manual browser check**

Enhanced View → Trends tab:
1. Each KPI renders its own chart card with insight-led title
2. InsightAside panel appears to the right of each chart (Finding / Driver / Impact / Action)
3. Dashed average reference line on each chart
4. Empty state message shows if `time_series` is empty

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add InsightAside and full Trends tab with insight-led titles"
```

---

## Task 8: DriverBarsSection and Drivers tab

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

- [ ] **Step 1: Add DriverBarsSection component**

Add before `InsightAside`:

```tsx
// ── DriverBarsSection ─────────────────────────────────────────────────────

function DriverBarsSection({
  dim,
  kpiName,
  breakdown,
  insight,
}: {
  dim: string;
  kpiName: string;
  breakdown: Array<{ name: string; value: number }>;
  insight?: DashboardInsight;
}) {
  if (!breakdown.length) return null;
  const avg = breakdown.reduce((s, r) => s + r.value, 0) / breakdown.length;
  const maxVal = Math.max(...breakdown.map((r) => r.value));
  const bottom = breakdown[breakdown.length - 1];
  const gap = (maxVal - bottom.value).toFixed(1);
  const title =
    insight?.headline ??
    `${kpiName} by ${dim} — ${breakdown[0].name} leads at ${maxVal.toFixed(1)}`;
  const subtitle = `Average: ${avg.toFixed(1)} · ${breakdown.length} segments · Gap: ${gap}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
      <div className="text-sm font-bold text-slate-900 mb-0.5 leading-snug">{title}</div>
      <div className="text-xs text-slate-500 mb-4">{subtitle}</div>
      <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-3">
        <span className="inline-block w-8 border-t-2 border-dashed border-slate-300" />
        Avg: {avg.toFixed(1)}
      </div>
      {breakdown.map((row) => {
        const pct = maxVal > 0 ? (row.value / maxVal) * 100 : 0;
        const above = row.value >= avg;
        return (
          <div
            key={row.name}
            className="grid items-center gap-3 py-1.5 border-b border-slate-50 last:border-0"
            style={{ gridTemplateColumns: "140px 1fr 60px" }}
          >
            <span
              className="text-xs text-slate-700 font-medium truncate"
              title={row.name}
            >
              {row.name}
            </span>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${above ? "bg-emerald-500" : "bg-red-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className={`text-xs font-bold text-right ${
                above ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {row.value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire Drivers tab in EnhancedDashboard**

Replace:
```tsx
{activeTab === "drivers"   && <div className="text-slate-400 text-sm py-8 text-center">Drivers — Task 8</div>}
```

With:

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
    ) : (
      Object.entries(data.dimension_breakdowns).map(([dim, kpis]) =>
        Object.entries(kpis).map(([kpiName, breakdown]) => (
          <DriverBarsSection
            key={`${dim}-${kpiName}`}
            dim={dim}
            kpiName={kpiName}
            breakdown={breakdown}
            insight={insightFor(kpiName)}
          />
        )),
      )
    )}
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Manual browser check**

Enhanced View → Drivers tab:
1. Each KPI × dimension combination renders its own bar section
2. Bar title uses insight headline if available, otherwise auto-generates from data
3. Bars are green for above-average segments, red for below-average
4. Empty state renders with "Edit recipe" link when no dimension breakdowns exist

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add color-coded DriverBarsSection and Drivers tab"
```

---

## Task 9: ActionTable, RootCauseCards, and Actions tab

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx`

- [ ] **Step 1: Add ActionTable component**

Add before `DriverBarsSection`:

```tsx
// ── ActionTable ───────────────────────────────────────────────────────────

function ActionTable({ insights }: { insights: DashboardInsight[] }) {
  const sorted = [...insights].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3),
  );
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {["Priority", "Action", "Expected Impact", "Owner"].map((h) => (
              <th
                key={h}
                className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((ins, i) => {
            const p = PRIORITY_STYLE[ins.severity] ?? PRIORITY_STYLE.low;
            return (
              <tr
                key={i}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
              >
                <td className="px-4 py-3 w-24">
                  <span
                    className={`flex items-center gap-2 text-xs font-bold capitalize ${p.text}`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.dot}`} />
                    {ins.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900 mb-0.5">
                    {ins.action}
                  </div>
                  <div className="text-xs text-slate-500 leading-relaxed">{ins.finding}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-700 w-36">{ins.impact}</td>
                <td className="px-4 py-3 text-xs text-slate-400 w-28">—</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add RootCauseCards component**

Add immediately after `ActionTable`:

```tsx
// ── RootCauseCards ────────────────────────────────────────────────────────

function RootCauseCards({ insights }: { insights: DashboardInsight[] }) {
  const top3 = [...insights]
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
    .slice(0, 3);
  const BORDERS = [
    "border-l-red-500",
    "border-l-amber-400",
    "border-l-slate-300",
  ] as const;
  const LABELS = ["text-red-600", "text-amber-600", "text-slate-400"] as const;
  return (
    <div className={`grid gap-4 grid-cols-1 md:grid-cols-${top3.length}`}>
      {top3.map((ins, i) => (
        <div
          key={i}
          className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 border-l-4 ${
            BORDERS[i] ?? BORDERS[2]
          }`}
        >
          <div
            className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${
              LABELS[i] ?? LABELS[2]
            }`}
          >
            Root Cause #{i + 1}
          </div>
          <div className="text-sm font-bold text-slate-900 mb-2 leading-snug">
            {ins.headline}
          </div>
          <div className="text-xs text-slate-600 leading-relaxed">{ins.driver}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire Actions tab in EnhancedDashboard**

Replace:
```tsx
{activeTab === "actions"   && <div className="text-slate-400 text-sm py-8 text-center">Actions — Task 9</div>}
```

With:

```tsx
{activeTab === "actions" && (
  <div>
    {data.insights.length === 0 ? (
      <div className="text-center py-16 text-slate-400 text-sm">
        No insights available for this report. Add dimension data to generate recommendations.
      </div>
    ) : (
      <>
        <div className="text-xs text-slate-500 mb-4">
          {data.insights.length} insight{data.insights.length !== 1 ? "s" : ""} · sorted by
          priority
        </div>
        <ActionTable insights={data.insights} />
        <EnhancedSectionHeading>Root Cause Summary</EnhancedSectionHeading>
        <RootCauseCards insights={data.insights} />
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles and lint passes**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: no errors. If ESLint warns about the dynamic `grid-cols-${top3.length}` class in `RootCauseCards`, replace the dynamic Tailwind class with an explicit conditional:

```tsx
// Replace the dynamic grid-cols class:
className={`grid gap-4 ${
  top3.length === 1 ? "grid-cols-1" :
  top3.length === 2 ? "grid-cols-1 md:grid-cols-2" :
  "grid-cols-1 md:grid-cols-3"
}`}
```

- [ ] **Step 5: Manual browser check**

Enhanced View → Actions tab:
1. Priority action table renders with red/orange/amber/grey priority dots
2. Each row shows: priority, action text + finding sub-text, expected impact, "—" owner placeholder
3. Rows are sorted by severity (critical first)
4. Root Cause cards appear below with colored left borders
5. Empty state shows when no insights exist

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): add ActionTable, RootCauseCards, and Actions tab"
```

---

## Task 10: Final integration check, build verification, and cleanup

**Files:**
- Modify: `frontend/app/dashboard/[recipeId]/page.tsx` — cleanup only

- [ ] **Step 1: Remove unused `insightFor` from DashboardPage (Classic View)**

In `DashboardPage`, find the Classic View's:
```typescript
const insightFor = (kpiName: string) =>
  data.insights.find((ins) => ins.headline.startsWith(kpiName));
```

This still needs to exist for the Classic View's `TrendChart` calls. Verify it is still referenced in the Classic View render — if it is, leave it. If not (ESLint reports unused), remove it.

- [ ] **Step 2: Verify full TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Verify lint**

```bash
cd frontend && npm run lint
```

Expected: 0 errors. Fix any warnings about unused variables or missing keys.

- [ ] **Step 4: Run production build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors. Warnings about image optimization or metadata are acceptable.

- [ ] **Step 5: Full manual browser walkthrough**

Start dev server: `cd frontend && npm run dev`

**Classic View checklist:**
- [ ] Dashboard loads at `/dashboard/{id}`
- [ ] Classic / Enhanced toggle visible in header
- [ ] All existing sections render: KPI scorecards, trend charts, driver charts, insights
- [ ] Filter bar updates data on selection
- [ ] "Edit recipe" navigates to `/recipe/{id}`
- [ ] Approved/Draft badge shows correctly

**Enhanced View checklist:**
- [ ] Toggle to Enhanced view — navy header appears with title, subtitle, badges, toggle, Edit recipe
- [ ] Freshness strip below header shows coverage, row count, warnings
- [ ] Four tabs visible with correct icons
- [ ] ⚡ Actions tab shows a red badge count for high/critical insights

**Enhanced — Overview tab:**
- [ ] Executive banner shows highest-severity insight with driver/impact/action pills
- [ ] KPI cards show value, delta (with correct direction-aware coloring), status, prior, interpretation, sparkline
- [ ] Trend snapshot shows 2 charts with insight-led titles
- [ ] "View full trends →" link switches to Trends tab

**Enhanced — Trends tab:**
- [ ] One chart per KPI with insight-led title and finding subtitle
- [ ] InsightAside panel to the right of each chart
- [ ] Dashed average reference line on charts
- [ ] Empty state if no time series data

**Enhanced — Drivers tab:**
- [ ] Color-coded horizontal bars (green = above avg, red = below)
- [ ] Insight-led section title
- [ ] Empty state with Edit recipe button when no dimensions

**Enhanced — Actions tab:**
- [ ] Rows sorted by severity (critical → low)
- [ ] Root cause cards below the table
- [ ] Empty state when no insights

**Filter interaction (Enhanced View):**
- [ ] Select a filter → data refreshes → "Updating…" pulse shows → all tabs update
- [ ] Clear all → data resets

- [ ] **Step 6: Final commit**

```bash
git add frontend/app/dashboard/[recipeId]/page.tsx
git commit -m "feat(dashboard): complete Enhanced View with 4-tab executive layout

- Classic View preserved with view toggle in header
- Enhanced View: sticky navy header, 4-tab layout (Overview/Trends/Drivers/Actions)
- Overview: executive banner, rich KPI cards with sparklines + interpretation, trend snapshot
- Trends: insight-led chart titles with InsightAside panel per KPI
- Drivers: color-coded horizontal bars (green/red vs average), auto-generated insight titles
- Actions: priority-sorted action table + root cause cards
- All existing functionality preserved: Edit recipe, filter bar, approved badge, filter re-fetch
- View preference persisted in localStorage"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Layout toggle (Classic / Enhanced) with localStorage → Task 3
- [x] Tabbed layout (4 tabs) → Task 4
- [x] Enhanced KPI cards with sparklines → Task 5
- [x] Insight-led chart titles → Tasks 6, 7
- [x] Executive situation banner → Task 5
- [x] Insight aside panel (Trends tab) → Task 7
- [x] Color-coded driver bars → Task 8
- [x] Priority action table → Task 9
- [x] Root cause cards → Task 9
- [x] Filter bar (functional) → Task 4 (reuses existing FilterBar)
- [x] Edit recipe button → Task 4 (EnhancedHeader)
- [x] Approved/Draft badge → Task 4 (EnhancedHeader)
- [x] Freshness strip → Task 4 (EnhancedFreshnessStrip)
- [x] `direction` field color inversion → Task 5 (`deltaClass` function)
- [x] View toggle in Classic View header → Task 3
- [x] Dashboard title from KPI names → Task 4 (`dashboardTitle` helper)

**No gaps found.**
