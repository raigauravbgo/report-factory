# Dashboard Design System

Reference: BGO Executive Dashboard (Bill Gosling Outsourcing)

---

## Color Palette

### Primary Brand
| Token | Hex | Usage |
|-------|-----|-------|
| `brand-teal` | `#00B5AD` | Sidebar bg, primary buttons, active tabs, accent borders |
| `brand-navy` | `#1B2340` | Dark sidebar nav, chart tooltip bg |
| `brand-gold` | `#F5A623` | BGO logo accent, sparkline dots |

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-page` | `#F4F6FA` | Main page background |
| `bg-card` | `#FFFFFF` | Card / panel background |
| `bg-sidebar-dark` | `#1B2340` | Dark nav sidebar |
| `bg-sidebar-teal` | `#00B5AD` | Teal KPI sidebar |
| `bg-filter-bar` | `#FFFFFF` | Top filter bar |

### Status & Trend Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `positive` | `#22C55E` | Up trend arrows, positive delta badges |
| `negative` | `#EF4444` | Down trend arrows, negative delta badges |
| `neutral` | `#9CA3AF` | Flat/no-change indicators |
| `warning` | `#F59E0B` | Near-threshold alerts |

### Chart Gradient Palette (bars, BU performance)
- Teal → Blue: `#00B5AD` → `#6366F1`
- Purple: `#A855F7`
- Orange: `#F97316`
- Green: `#22C55E`
- Use distinct solid colors per series; apply `opacity-80` on inactive

### KPI Card Icon Backgrounds
| KPI type | Color |
|----------|-------|
| Revenue / financial | `#6366F1` (indigo) |
| Margin / percentage | `#10B981` (emerald) |
| Headcount / workforce | `#6366F1` (indigo) |
| Attrition / risk | `#EF4444` (red) |

### Table Heatmap
| Range | Color |
|-------|-------|
| High / good | `#D1FAE5` (green-100) |
| Mid | `#FEF3C7` (amber-100) |
| Low / risk | `#FEE2E2` (red-100) |
| Highlight cell | `#A855F7` text on `#F3E8FF` bg |

---

## Typography

| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page/section title | Inter / system-ui | 20–24px | 600 |
| Card KPI value | Inter | 28–36px | 700 |
| Card label | Inter | 12–13px | 400 |
| Table header | Inter | 12px | 600 |
| Table cell | Inter | 13px | 400 |
| Filter label | Inter | 11px | 500, uppercase |
| Trend badge | Inter | 11–12px | 600 |
| Sidebar nav item | Inter | 14px | 500 |
| Chart axis | Inter | 11px | 400 |

---

## Layout

### Shell

```
┌──────────────────────────────────────────────────────────┐
│  [Dark Sidebar Nav 220px]  │  [Main Content Area]        │
│  Logo                      │  [Top Filter Bar]           │
│  Nav items                 │  [Tab Navigation]           │
│                            │  [KPI Cards Row]            │
│                            │  [Chart Grid]               │
│                            │  [Data Tables]              │
└──────────────────────────────────────────────────────────┘
```

### Variant — Teal KPI Sidebar

```
┌──────────────────────────────────────────────────────────┐
│  [Teal Sidebar 200px]  │  [Top Filters + Tabs]           │
│  Logo                  │  [Chart Section]                │
│  KPI Score Cards       │  [Vendor Comparison Chart]      │
│  (stacked vertically)  │  [Data Table]  [Summary Table]  │
└──────────────────────────────────────────────────────────┘
```

### Grid
- Chart row: 2-column CSS grid (`grid-cols-2`), gap-6
- KPI cards row: `grid-cols-4` (lg), `grid-cols-2` (sm)
- Full-width table below charts

---

## Components

### 1. Dark Sidebar Navigation
- Width: 220px, fixed
- Background: `#1B2340`
- Logo at top (40px height)
- Nav items: icon + label, 14px, white `opacity-70` default, white `opacity-100` + left border accent on active
- Items: Dashboards, Ask DataPilot, Build Dashboard, Reports
- Notification bell + avatar at top-right of header

### 2. Teal KPI Sidebar
- Width: 200px, fixed
- Background: `#00B5AD`
- Logo at top
- KPI cards stacked vertically:
  - Label (white, 12px, uppercase)
  - Value (white, 28–32px, bold)
  - Sparkline (dotted, amber/gold dots on white line)
- Subtle divider between cards

### 3. Top Filter Bar
- Full-width, white bg, border-bottom
- Dropdown filters: `Month`, `Location`, `Company`, `Region`, `Business Unit`
  - Style: border rounded-lg, chevron icon, 160px min-width
- Date quick-select pills: `Current Month` | `Prev Month` | `Year to Date` | `Rolling 12M` | `Custom Range`
  - Active pill: `bg-navy text-white`; inactive: `bg-gray-100 text-gray-600`
- Date range picker (custom range): two calendar inputs with arrow between
- Currency toggle (CAD / USD): pill-style toggle, active = filled navy

### 4. Tab Navigation
- Positioned below filter bar
- Style: underline tabs OR pill tabs
- Active tab: icon + label, underlined with teal or filled teal pill
- Examples: `Executive Summary`, `Workforce & Attrition`, `Reproject Revenue`; `Summary`, `POD & Department`

### 5. Score Filter Pills (secondary filter)
- Horizontal row of toggleable pills: `Overall Score`, `CSAT`, `IC`, `CF`
- Active: teal fill + white text; inactive: white + gray border
- Bell alert icon inline (amber, animated)

### 6. KPI Summary Card
```
┌─────────────────────────────────────┐
│  KPI Label           ▲ +$716.6K    │  ← trend badge (green/red)
│  Prev Period $15.88M                │  ← sub-label
│                                     │
│  $16.60M          [icon circle]     │  ← large value + icon
└─────────────────────────────────────┘
```
- White card, rounded-xl, shadow-sm
- Icon: colored circle (56px), white icon inside
- Trend badge: colored pill top-right (`▲ +X` green or `▼ -X` red)
- Sub-label: prev period comparison in gray

### 7. Combo Bar + Line Chart (Revenue & CM%) — **ECharts**
- `echarts-for-react` `ReactECharts`, option type `mixed`
- Bars: `type: 'bar'`, gradient fill (indigo), `opacity: 1` complete / `0.4` projected
- Line: `type: 'line'`, green `#22C55E`, symbol dots, `markLine` for 13% and 15% targets (dashed)
- Dual Y-axis: `yAxis[0]` revenue ($M), `yAxis[1]` CM%
- `tooltip: { trigger: 'axis' }`, dark background custom formatter
- `legend` below chart
- Expand icon (↗) top-right of card wrapper

### 8. Horizontal Bar Chart (BU Performance / Revenue by Country) — **ECharts**
- `type: 'bar'`, `orient: 'horizontal'`
- `itemStyle.color` linear gradient teal→blue (or orange per series)
- `label: { show: true, position: 'right' }` — value at end of bar
- `barMaxWidth: 32`, `borderRadius: [0, 6, 6, 0]`
- `grid.left: '30%'` to make room for long category labels
- `onClick` handler for drill-down

### 9. Sparkline / Area Chart (Vendor Performance Trend) — **Recharts**
- Small multiples 2×N grid of `<AreaChart>` cards
- No axes, no legend — data point labels only (`<LabelList>`)
- `<Area>` gray fill `#E5E7EB`, darker stroke `#6B7280`
- Vendor name as card title above chart
- Fixed height 80px per sparkline

### 10. Vendor Comparison Bar Chart — **ECharts**
- Vertical `type: 'bar'`
- Selected/highlighted bar: olive green `#6B7C3A`; others: beige `#D4C5A9`
- `label: { show: true, position: 'top' }`
- `axisLabel.rotate: 30` on x-axis for vendor name labels

### 11. Data Table with Trend Arrows — **HTML Table**
```
│ KPI │ Vendor │ Dec-25 % │ Trend │ Jan-26 % │ Trend │ ...
│ CF  │ Alorica│  6.32%   │ ▼6.6% │  4.80%   │ ▼24.1%│
```
- Sticky header with column group spans (Month → Dec-25 → Jan-26)
- Trend cell: red ▼ or green ▲ badge with percentage, bold
- Alternating `bg-gray-50` rows
- Horizontal scroll container
- Grouping rows by KPI with expand/collapse toggle

### 12. Vendor Summary Table (heatmap) — **HTML Table**
```
│ Vendor      │ Overall │ CSAT  │ QA Score │ IC    │ Compliance │
│ Alorica     │  3.45   │ 58.20%│  90.25%  │91.38% │   4.78%   │
```
- Sticky first column
- Cell background heatmap: green → amber → red per column min/max
- Special highlight: purple bg for top performer in column
- Sortable column headers

### 13. CM% vs Target Band Chart — **ECharts**
- `type: 'line'` with two `markArea` bands (13–15% target range, light yellow fill)
- Out-of-band anomaly chips via `markPoint` with custom label formatter
- Props: `data`, `targetMin`, `targetMax`

### 14. Gauge / Score Chart (Overall Score) — **ECharts**
- `type: 'gauge'` for composite score display
- Arc gauge, teal fill, value label in center
- Used in sidebar or summary card variant

---

## Spacing & Shape

| Token | Value |
|-------|-------|
| Card border-radius | `rounded-xl` (12px) |
| Card shadow | `shadow-sm` (0 1px 3px rgba(0,0,0,0.08)) |
| Card padding | `p-5` or `p-6` |
| Section gap | `gap-6` (24px) |
| Filter bar height | 56px |
| Tab bar height | 48px |
| Sidebar width (dark) | 220px |
| Sidebar width (teal) | 200px |

---

## Interactions

| Trigger | Behaviour |
|---------|-----------|
| Chart bar click | Drill down (e.g. Country → BU breakdown) |
| KPI card expand icon | Full-screen modal or drawer |
| Score pill toggle | Filter all charts to selected metric |
| Date quick-select | Instantly re-query and re-render all charts |
| Table row expand | Reveal sub-vendor or sub-KPI breakdown |
| Tooltip | Recharts default, dark rounded card |
| Trend badge hover | Show tooltip with raw values |

---

## Responsive Breakpoints

| Breakpoint | Layout change |
|------------|--------------|
| `lg` (1024px+) | Full layout, 2-col charts, sidebar visible |
| `md` (768px) | Sidebar collapses to icon rail, charts stack |
| `sm` (640px) | Single-column, KPI cards 2-up |
