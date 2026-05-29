# Dashboard Component Skills

Implementation guide for building the BGO Executive Dashboard UI.
Reference the `design.md` file for all colors, spacing, and visual specs.

---

## Shell & Navigation

### DarkSidebar
**File:** `frontend/components/layout/DarkSidebar.tsx`
- Fixed 220px left sidebar, `bg-[#1B2340]`
- Logo image at top
- Nav items: `{ icon, label, href }` — highlight active route with left teal border + full opacity
- Notification bell + user avatar row at top
- Collapses to 64px icon rail on `md` breakpoint

### TealKpiSidebar
**File:** `frontend/components/layout/TealKpiSidebar.tsx`
- Fixed 200px left sidebar, `bg-[#00B5AD]`
- Logo at top
- Renders `<SidebarKpiCard>` for each KPI (stacked, full width)
- Used on Vendor Performance / CSAT views

### SidebarKpiCard
**File:** `frontend/components/layout/SidebarKpiCard.tsx`
- Props: `label`, `value`, `unit`, `sparklineData: number[]`
- White label (12px uppercase), white value (32px bold)
- Inline sparkline using Recharts `<LineChart>` — dots only, no axes, amber dots
- Bottom border divider

---

## Filters

### FilterBar
**File:** `frontend/components/filters/FilterBar.tsx`
- Full-width white bar, `border-b`, `h-14`
- Renders slot for `<DropdownFilter>` items (left) and `<DateRangeFilter>` (right)
- `<CurrencyToggle>` (CAD/USD) far right when applicable

### DropdownFilter
**File:** `frontend/components/filters/DropdownFilter.tsx`
- Props: `label`, `options: {value, label}[]`, `value`, `onChange`
- Styled select: `rounded-lg border border-gray-300`, chevron icon, 160px min-width
- Small uppercase label above select

### DateRangeFilter
**File:** `frontend/components/filters/DateRangeFilter.tsx`
- Quick-select pills: `Current Month | Prev Month | Year to Date | Rolling 12M | Custom Range`
- Active pill: `bg-[#1B2340] text-white rounded-full`; inactive: `bg-gray-100 text-gray-600`
- When `Custom Range` active: show two `<input type="month">` with `→` between
- Emits `{ preset, startDate, endDate }` on change

### ScorePillFilter
**File:** `frontend/components/filters/ScorePillFilter.tsx`
- Props: `options: string[]`, `active: string`, `onChange`
- Horizontal pill row: active = `bg-[#00B5AD] text-white`, inactive = `border border-gray-300`
- Optional amber bell icon (animated pulse) inline

### CurrencyToggle
**File:** `frontend/components/filters/CurrencyToggle.tsx`
- Two-state pill toggle: `CAD` / `USD`
- Active: filled navy; inactive: outlined gray

---

## Tab Navigation

### TabNav
**File:** `frontend/components/layout/TabNav.tsx`
- Props: `tabs: { label, href, icon? }[]`
- Underline variant: active tab has `border-b-2 border-[#00B5AD]` + icon
- Renders below `<FilterBar>`

---

## KPI Cards

### KpiSummaryCard
**File:** `frontend/components/kpis/KpiSummaryCard.tsx`
- Props: `label`, `value`, `unit`, `prevValue`, `prevLabel`, `trendValue`, `trendDirection: 'up'|'down'|'flat'`, `iconColor`, `icon`
- White card, `rounded-xl shadow-sm p-5`
- Top-right trend badge: green pill (▲ +X) or red pill (▼ -X)
- Sub-label below badge: `Prev Period $X`
- Bottom: large value left, colored icon circle right
- Icon circle: 56px, colored bg, white icon SVG inside

### KpiTileGrid
**File:** `frontend/components/kpis/KpiTileGrid.tsx`
- Renders `<KpiSummaryCard>` in a responsive grid
- Props: `kpis: KpiSummaryCard[]`, columns default 4
- `grid-cols-4 gap-4` on lg, `grid-cols-2` on sm

---

## Charts

### Library Assignment

| Chart | Library | Reason |
|-------|---------|--------|
| Revenue & CM% combo | **ECharts** | Dual Y-axis + gradient bars + markLine targets |
| BU / Country horizontal bars | **ECharts** | Gradient fill + drill-down click events |
| Vendor comparison vertical bars | **ECharts** | Per-bar color + angled labels |
| CM% vs Target Band | **ECharts** | markArea bands + markPoint anomaly chips |
| Gauge / score arc | **ECharts** | Native gauge type |
| Vendor sparklines | **Recharts** | Lightweight small-multiples, no axes needed |
| KPI card mini-sparkline | **Recharts** | Inline `<Sparkline>` in sidebar cards |
| Dashboard KPI charts | **Recharts** | Simple bar/line/pie from existing ChartCard |

### Packages installed
```
echarts@6.1.0
echarts-for-react@3.0.6
recharts@3.8.1   (already present)
```

### Base ECharts wrapper
**File:** `frontend/components/charts/EChart.tsx`
```tsx
"use client";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

interface Props {
  option: EChartsOption;
  height?: string;   // default "320px"
  onEvents?: Record<string, (params: any) => void>;
}

export default function EChart({ option, height = "320px", onEvents }: Props) {
  return (
    <ReactECharts
      option={option}
      style={{ height }}
      notMerge
      lazyUpdate
      onEvents={onEvents}
    />
  );
}
```

### RevenueComboChart — ECharts
**File:** `frontend/components/charts/RevenueComboChart.tsx`
- Props: `data: { month, revenue, cm }[]`, `targetMin`, `targetMax`
- ECharts option:
  - `xAxis`: month labels
  - `yAxis[0]`: revenue (`$M`), `yAxis[1]`: CM% (right)
  - `series[0]`: bar — indigo gradient, opacity split complete/projected
  - `series[1]`: line — green `#22C55E`, smooth, yAxisIndex 1
  - `series[2/3]`: markLine at targetMin / targetMax (dashed gray)
  - `tooltip.trigger: 'axis'`, dark formatter
- Card wrapper: `<ChartCard title="Revenue & CM%" subtitle="..." expandable>`

### HorizontalBarChart — ECharts
**File:** `frontend/components/charts/HorizontalBarChart.tsx`
- Props: `data: { label, value, color? }[]`, `unit`, `title`, `subtitle?`, `onBarClick?`
- ECharts option:
  - `yAxis.type: 'category'`, `xAxis.type: 'value'`
  - `series.type: 'bar'`, gradient `itemStyle.color` teal→blue per bar
  - `label: { show: true, position: 'right', formatter: '{c}' }`
  - `barMaxWidth: 28`, `borderRadius: [0,6,6,0]`
- `onEvents: { click: onBarClick }`
- Scrollable via `dataZoom` if > 8 items

### VendorComparisonBar — ECharts
**File:** `frontend/components/charts/VendorComparisonBar.tsx`
- Props: `vendors: { name, value }[]`, `highlightName: string`
- Bar color: highlighted = `#6B7C3A`, others = `#D4C5A9`
- `label: { show: true, position: 'top' }`
- `axisLabel.interval: 0, rotate: 30`

### TargetBandChart — ECharts
**File:** `frontend/components/charts/TargetBandChart.tsx`
- Props: `data: { month, value }[]`, `targetMin: number`, `targetMax: number`, `title`
- `markArea`: two bands — target range (light yellow) + below-target (light red)
- `markPoint` on out-of-band points with custom label chip
- Smooth line, circular dots

### SparklineGrid — Recharts
**File:** `frontend/components/charts/SparklineGrid.tsx`
- Props: `vendors: { name, data: { month, value }[] }[]`
- 2×N CSS grid of small `<AreaChart height={80}>` cards
- `<Area>` fill `#E5E7EB`, stroke `#6B7280`
- `<LabelList>` above each point (value %)
- No `<XAxis>` / `<YAxis>` / `<Tooltip>` — labels only
- Vendor name `<h4>` above each chart

### SidebarSparkline — Recharts
**File:** `frontend/components/charts/SidebarSparkline.tsx`
- Props: `data: number[]`
- Inline `<LineChart width={120} height={40}>`
- Amber dots `#F5A623`, no axes, no tooltip
- Used inside `<SidebarKpiCard>`

---

## Tables

### KpiTrendTable
**File:** `frontend/components/tables/KpiTrendTable.tsx`
- Props: `rows: { kpi, vendor, months: { month, value, trend }[] }[]`
- Sticky first two columns (KPI, Vendor)
- Column group headers: Month name spans two sub-columns (%, Trend)
- Trend cell: red ▼ or green ▲ with percentage, bold
- Alternating `bg-gray-50` rows
- Grouping by KPI with expand/collapse toggle
- Horizontal scroll container

### VendorSummaryTable
**File:** `frontend/components/tables/VendorSummaryTable.tsx`
- Props: `vendors: { name, overallScore, csat, qaScore, ic, complianceFail }[]`
- Sticky first column (Vendor name)
- Cell background heatmap: `getHeatmapColor(value, min, max)` → green/amber/red
- Special highlight cell: purple bg for top performer
- Sortable columns (click header)

---

## Shared UI

### ChartCard
**File:** `frontend/components/ui/ChartCard.tsx`
- Props: `title`, `subtitle?`, `expandable?`, `children`
- White card, `rounded-xl shadow-sm p-5`
- Header: title + subtitle left, expand icon `↗` right
- `onClick` expand → full-screen modal overlay

### SectionHeader
**File:** `frontend/components/ui/SectionHeader.tsx`
- Left teal border accent (`border-l-4 border-[#00B5AD] pl-3`)
- Bold section label (e.g. "Margin & Geography", "Performance Overview")

### TrendBadge
**File:** `frontend/components/ui/TrendBadge.tsx`
- Props: `value: string`, `direction: 'up'|'down'|'flat'`
- Pill: `bg-green-100 text-green-700` / `bg-red-100 text-red-700`
- Arrow icon + value text

### HeatmapCell
**File:** `frontend/components/ui/HeatmapCell.tsx`
- Props: `value: number`, `min: number`, `max: number`, `format?: string`
- Returns `<td>` with computed background color
- Color scale: green (high) → amber (mid) → red (low), configurable

---

## Page Layouts

### ExecutiveSummaryPage
**File:** `frontend/app/dashboard/[recipeId]/executive-summary.tsx`
- `<FilterBar>` with Company/Region/BU dropdowns + date range + currency toggle
- `<TabNav>` (Executive Summary | Workforce & Attrition | Reproject Revenue)
- `<KpiTileGrid>` (6–8 cards: Revenue, CM, Margin%, Headcount, Attrition, Rev MoM, Rev/Employee)
- `<SectionHeader>` "Performance Overview"
- 2-col chart grid: `<RevenueComboChart>` + `<HorizontalBarChart>`
- `<SectionHeader>` "Margin & Geography"
- 2-col: `<TargetBandChart>` + `<HorizontalBarChart>` (Revenue by Country)

### VendorPerformancePage
**File:** `frontend/app/dashboard/[recipeId]/vendor-performance.tsx`
- `<TealKpiSidebar>` (Overall Score, QA Score, Compliance, CSAT)
- `<FilterBar>` (Month, Location)
- `<TabNav>` (Summary | POD & Department)
- `<ScorePillFilter>` (Overall Score, CSAT, IC, CF)
- Alert bell icon
- Section: "Composite Score Section" heading
- `<SparklineGrid>` for vendor trends
- `<VendorComparisonBar>` for current month
- `<KpiTrendTable>` full width
- `<VendorSummaryTable>` right panel

---

## Utility Functions

### `getHeatmapColor(value, min, max, invert?)`
**File:** `frontend/lib/heatmap.ts`
- Returns Tailwind bg class or hex color
- `invert=true` for metrics where low = good (e.g. attrition, compliance fail)

### `formatKpiValue(value, unit)`
**File:** `frontend/lib/format.ts`
- `$` prefix for revenue, `%` suffix for rates, comma-separated integers
- Abbreviate: `1_200_000 → $1.2M`, `0.1324 → 13.2%`

### `computeTrend(current, previous)`
**File:** `frontend/lib/trend.ts`
- Returns `{ direction: 'up'|'down'|'flat', pct: string, abs: string }`

---

## Implementation Order

1. `DarkSidebar` + `TealKpiSidebar` + `FilterBar` + `TabNav` — shell first
2. `KpiSummaryCard` + `KpiTileGrid` — data visible immediately
3. `RevenueComboChart` + `HorizontalBarChart` — primary charts
4. `SparklineGrid` + `VendorComparisonBar` — vendor view
5. `KpiTrendTable` + `VendorSummaryTable` — tables
6. `TargetBandChart` + `SectionHeader` + expand modal — polish
7. Filters wired to data: `DateRangeFilter` → re-fetch → all charts update
