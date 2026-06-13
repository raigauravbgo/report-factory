"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
  LabelList,
} from "recharts";
import { api } from "@/lib/api";
import type {
  DashboardData, DashboardInsight, DashboardMetric,
  DataQuality, RecipeResponse,
} from "@/lib/types";

interface PageProps { params: Promise<{ recipeId: string }> }

const CHART_COLORS = ["#1d4ed8", "#059669", "#b45309", "#7c3aed", "#0891b2"];

const STATUS_CFG: Record<string, { border: string; value: string; pill: string; arrow: string }> = {
  good:    { border: "border-l-emerald-500", value: "text-emerald-700", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",  arrow: "text-emerald-600" },
  warning: { border: "border-l-amber-500",   value: "text-amber-700",   pill: "bg-amber-50 text-amber-700 ring-amber-200",        arrow: "text-amber-600"  },
  risk:    { border: "border-l-red-500",      value: "text-red-700",     pill: "bg-red-50 text-red-700 ring-red-200",              arrow: "text-red-600"    },
  neutral: { border: "border-l-slate-300",   value: "text-slate-800",   pill: "bg-slate-50 text-slate-500 ring-slate-200",        arrow: "text-slate-500"  },
};

const SEV_CFG: Record<string, { accent: string; tag: string }> = {
  critical: { accent: "border-l-red-600",    tag: "bg-red-100 text-red-700"   },
  high:     { accent: "border-l-red-400",    tag: "bg-red-50 text-red-600"    },
  medium:   { accent: "border-l-amber-400",  tag: "bg-amber-50 text-amber-700"},
  low:      { accent: "border-l-slate-300",  tag: "bg-slate-100 text-slate-500"},
};

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
  good: "#16a34a", warning: "#d97706", risk: "#dc2626", neutral: "#475569",
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

// ── Enhanced View — pure helpers ──────────────────────────────────────────

function getInsightForKpi(
  insights: DashboardInsight[],
  kpiName: string,
): DashboardInsight | undefined {
  // Absolute-snapshot insights start with "{kpiName}: ..."; benchmark insights
  // read "{segment} leads {kpiName} at ...". Match either form (fall back to a
  // plain substring) so KPI cards and insight-led titles actually surface.
  return (
    insights.find((ins) => ins.headline.startsWith(`${kpiName}:`)) ??
    insights.find((ins) => ins.headline.includes(` ${kpiName} `)) ??
    insights.find((ins) => ins.headline.includes(kpiName))
  );
}

function deltaClass(delta: number | null, direction: string): string {
  if (delta === null) return "text-slate-400";
  const up = delta >= 0;
  const good = direction === "lower_is_better" ? !up : up;
  return good ? "text-emerald-600" : "text-red-600";
}

/** Compact numeric formatter — drops trailing .0, keeps one decimal otherwise. */
function formatNum(v: number): string {
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

/**
 * Turn a raw pandas period string into a clean axis label.
 *   "2026-04-27/2026-05-03" (weekly) → "Apr 27"
 *   "2026-03"               (monthly) → "Mar '26"
 *   "2026-03-15"            (daily)   → "Mar 15"
 */
function formatPeriodLabel(period: unknown): string {
  if (typeof period !== "string") return String(period ?? "");
  const slash = period.indexOf("/");
  const base = slash > -1 ? period.slice(0, slash) : period;
  let m = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  m = base.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return `${d.toLocaleDateString("en-US", { month: "short" })} '${m[1].slice(2)}`;
  }
  return base;
}

/** Y-axis domain padded around the data so the line never hugs an edge. */
function niceDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
  }
  const pad = (hi - lo) * 0.25;
  return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
}

function dashboardTitle(kpis: Array<{ name: string }>): string {
  if (!kpis.length) return "Dashboard";
  const s = kpis.map((k) => k.name).join(" · ");
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

// ── SparkLine ─────────────────────────────────────────────────────────────

function SparkLine({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 100, H = 28, PAD = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - PAD - ((v - min) / range) * (H - PAD * 2),
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const last = coords[coords.length - 1];
  const gid = `spark-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-6 mt-1.5 overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
    </svg>
  );
}

// ── EnhancedTrendChart ────────────────────────────────────────────────────

function EnhancedTrendChart({
  series,
  color,
  height = 220,
}: {
  series: Array<{ period: string; value: number }>;
  color: string;
  height?: number;
}) {
  const avg = series.length
    ? series.reduce((s, p) => s + p.value, 0) / series.length
    : null;
  const domain = niceDomain(series.map((p) => p.value));
  const showLabels = series.length <= 9;
  const gradId = `area-${color.replace("#", "")}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 24, right: 18, bottom: 6, left: -4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
        <XAxis
          dataKey="period"
          tickFormatter={formatPeriodLabel}
          tick={{ fontSize: 10, fill: "#64748b" }}
          tickLine={false}
          axisLine={{ stroke: "#e2e8f0" }}
          interval="preserveStartEnd"
          minTickGap={28}
          height={22}
          dy={4}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v) => formatNum(Number(v))}
        />
        <Tooltip
          labelFormatter={(l) => formatPeriodLabel(l)}
          formatter={(v) => [formatNum(Number(v)), "Value"]}
          contentStyle={{
            fontSize: 12,
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            boxShadow: "0 4px 14px rgba(15,23,42,.10)",
            padding: "8px 12px",
          }}
          itemStyle={{ color: "#0f172a", fontWeight: 600 }}
          labelStyle={{ color: "#64748b", fontWeight: 500, marginBottom: 2 }}
          cursor={{ stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "3 3" }}
        />
        {avg !== null && (
          <ReferenceLine
            y={avg}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{
              value: `avg ${formatNum(avg)}`,
              position: "right",
              fontSize: 9,
              fill: "#94a3b8",
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.75}
          fill={`url(#${gradId})`}
          dot={{ r: 3.5, fill: "#fff", stroke: color, strokeWidth: 2 }}
          activeDot={{ r: 5.5, strokeWidth: 0, fill: color }}
        >
          {showLabels && (
            <LabelList
              dataKey="value"
              position="top"
              offset={10}
              fontSize={10}
              fill="#475569"
              formatter={(v) => formatNum(Number(v))}
            />
          )}
        </Line>
      </LineChart>
    </ResponsiveContainer>
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
                className="text-left text-[9px] font-bold uppercase tracking-wider text-slate-400 px-3 py-2"
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
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors align-top"
              >
                <td className="px-3 py-2.5 w-20">
                  <span
                    className={`flex items-center gap-1.5 text-[11px] font-bold capitalize ${p.text}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.dot}`} />
                    {ins.severity}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-xs font-semibold text-slate-900 mb-0.5 leading-snug">
                    {ins.action}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-snug">{ins.finding}</div>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-700 leading-snug w-36">{ins.impact}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400 w-20">—</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
  const gridCls =
    top3.length === 1 ? "grid-cols-1" :
    top3.length === 2 ? "grid-cols-1 md:grid-cols-2" :
    "grid-cols-1 md:grid-cols-3";
  return (
    <div className={`grid gap-4 ${gridCls}`}>
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
  const values = breakdown.map((r) => r.value);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo;
  const allEqual = span < 0.05; // every segment identical → uniform full bars
  const bottom = breakdown[breakdown.length - 1];
  const gap = (hi - bottom.value).toFixed(1);
  // Map the lowest value to 45% and the highest to 100% so a tight 89–99 spread
  // is clearly differentiated, yet the smallest bar still reads as substantial
  // (never a misleading sliver). All values equal → every bar full.
  const barPct = (v: number) => (allEqual ? 100 : 45 + ((v - lo) / span) * 55);
  const avgPct = barPct(avg);
  const title =
    insight?.headline ??
    `${kpiName} by ${dim} — ${breakdown[0].name} leads at ${formatNum(hi)}`;
  const subtitle = `Avg ${formatNum(avg)} · ${breakdown.length} segments · ${formatNum(
    Number(gap),
  )} pt spread (${formatNum(lo)}–${formatNum(hi)})`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-[13px] font-bold text-slate-900 mb-0.5 leading-snug">{title}</div>
      <div className="text-[11px] text-slate-500 mb-3">{subtitle}</div>
      {breakdown.map((row) => {
        const pct = barPct(row.value);
        const above = row.value >= avg;
        return (
          <div
            key={row.name}
            className="grid items-center gap-3 py-1 border-b border-slate-50 last:border-0"
            style={{ gridTemplateColumns: "150px 1fr 52px" }}
          >
            <span
              className="text-[11px] text-slate-700 font-medium truncate"
              title={row.name}
            >
              {row.name}
            </span>
            <div className="relative h-2.5 rounded-full bg-slate-100">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${
                  above ? "bg-emerald-500" : "bg-red-400"
                }`}
                style={{ width: `${pct}%` }}
              />
              {/* Average marker — hidden when every segment is identical */}
              {!allEqual && (
                <div
                  className="absolute inset-y-[-2px] w-px bg-slate-500"
                  style={{ left: `${avgPct}%` }}
                  title={`Average ${formatNum(avg)}`}
                />
              )}
            </div>
            <span
              className={`text-[11px] font-bold tabular-nums text-right ${
                above ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {formatNum(row.value)}
            </span>
          </div>
        );
      })}
      {!allEqual && (
        <div className="flex items-center gap-1.5 mt-2.5 text-[10px] text-slate-400">
          <span className="inline-block w-px h-3 bg-slate-500" />
          Average ({formatNum(avg)}) · bars scaled across the segment range
        </div>
      )}
      {allEqual && (
        <div className="mt-2.5 text-[10px] text-slate-400">
          All segments equal at {formatNum(hi)} — no variation to compare.
        </div>
      )}
    </div>
  );
}

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

// ── ExecutiveBanner ───────────────────────────────────────────────────────

function ExecutiveBanner({ insights }: { insights: DashboardInsight[] }) {
  if (!insights.length) return null;
  const top =
    insights.find((i) => i.severity === "critical" || i.severity === "high") ?? insights[0];
  const cfg = SEV_BANNER[top.severity] ?? SEV_BANNER.low;
  return (
    <div
      className={`border-l-4 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-4 ${cfg.border}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base flex-shrink-0 mt-0.5">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-[9px] font-bold uppercase tracking-wider ${cfg.label}`}>
              {top.severity}
            </span>
            <span className="text-[13px] font-bold text-slate-900 leading-snug">
              {top.headline}
            </span>
          </div>
          <div className="text-[11px] text-slate-600 leading-snug mb-2">{top.finding}</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800">
              Driver: {top.driver}
            </span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-50 text-red-800">
              Impact: {top.impact}
            </span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-800">
              Action: {top.action}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const deltaPct = metric.delta_pct ?? 0;
  const isFlat = Math.abs(deltaPct) < 0.05; // rounds to 0.0%
  const up = (metric.delta ?? 0) >= 0;
  const dColor = isFlat ? "text-slate-400" : deltaClass(metric.delta, metric.direction);
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
      className={`bg-white rounded-xl border border-slate-200 shadow-sm p-3 border-t-[3px] ${topBorder} hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">
          {metric.name}
        </span>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ring-inset capitalize shrink-0 ${badgeCls}`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-extrabold tabular-nums leading-none ${valColor}`}>
          {formatNum(metric.value)}
        </span>
        {hasDelta && (
          <span className={`text-[11px] font-bold ${dColor} whitespace-nowrap`}>
            {isFlat
              ? "No change"
              : `${up ? "▲" : "▼"} ${Math.abs(deltaPct).toFixed(1)}%`}
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">
        {metric.prior_value !== null ? `Prior ${formatNum(metric.prior_value)}` : "Baseline"}
        {metric.period ? ` · ${metric.period}` : ""} · {metric.count.toLocaleString()} recs
      </div>
      {insight && (
        <div
          className={`text-[10px] leading-snug px-2 py-1.5 rounded-md border-l-2 mt-1.5 line-clamp-2 ${interpCls}`}
          title={insight.finding}
        >
          {insight.finding}
        </div>
      )}
      {sparkValues.length >= 2 && (
        <div className="-mb-0.5">
          <SparkLine values={sparkValues} color={sparkCol} />
        </div>
      )}
    </div>
  );
}

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
    view, onViewChange, onFilterChange, onEditRecipe,
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
      <div className="max-w-6xl mx-auto px-6 py-5">
        {/* Filter bar — all tabs */}
        {Object.keys(filterOptions).length > 0 && (
          <div className="mb-4">
            <FilterBar
              options={filterOptions}
              active={activeFilters}
              onChange={onFilterChange}
              loading={filtering}
            />
          </div>
        )}

        {activeTab === "overview" && (
          <div>
            {/* Situation banner */}
            <ExecutiveBanner insights={data.insights} />

            {/* KPI Scorecards */}
            {data.metrics.length > 0 && (
              <section className="mb-6">
                <EnhancedSectionHeading>KPI Scorecards</EnhancedSectionHeading>
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
                  Trend Snapshot · all KPIs
                </EnhancedSectionHeading>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(data.time_series).map(([kpiName, series], i) => {
                    const latest = series.length ? series[series.length - 1].value : null;
                    return (
                      <div
                        key={kpiName}
                        className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
                            {kpiName}
                          </span>
                          {latest !== null && (
                            <span className="text-sm font-extrabold tabular-nums text-slate-900 shrink-0">
                              {formatNum(latest)}
                            </span>
                          )}
                        </div>
                        <EnhancedTrendChart
                          series={series}
                          color={CHART_COLORS[i % CHART_COLORS.length]}
                          height={130}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
        {activeTab === "trends" && (
          <div>
            {Object.keys(data.time_series).length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">
                No trend data available. Ensure your recipe includes a date column and at least two time periods.
              </div>
            ) : (
              Object.entries(data.time_series).map(([kpiName, series], i) => {
                const ins = insightFor(kpiName);
                return (
                  <div
                    key={kpiName}
                    className={`grid gap-4 mb-6 ${ins ? "lg:grid-cols-[1fr_280px]" : ""}`}
                  >
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                      <div className="text-[13px] font-bold text-slate-900 mb-1 leading-snug">
                        {ins?.headline ?? kpiName}
                      </div>
                      {ins && (
                        <div className="text-[11px] text-slate-500 mb-3 leading-snug">
                          {ins.finding}
                        </div>
                      )}
                      <EnhancedTrendChart
                        series={series}
                        color={CHART_COLORS[i % CHART_COLORS.length]}
                        height={210}
                      />
                    </div>
                    {ins && <InsightAside insight={ins} />}
                  </div>
                );
              })
            )}
          </div>
        )}
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
              <div className="grid gap-3 lg:grid-cols-2 items-start">
                {Object.entries(data.dimension_breakdowns).flatMap(([dim, kpis]) =>
                  Object.entries(kpis).map(([kpiName, breakdown]) => (
                    <DriverBarsSection
                      key={`${dim}-${kpiName}`}
                      dim={dim}
                      kpiName={kpiName}
                      breakdown={breakdown}
                      insight={insightFor(kpiName)}
                    />
                  )),
                )}
              </div>
            )}
          </div>
        )}
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
      </div>
    </div>
  );
}

// ── Shared section heading ────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</h2>
      <div className="flex-1 border-t border-slate-100" />
    </div>
  );
}

// ── Data freshness strip ──────────────────────────────────────────────────────

function FreshnessStrip({ dq, generatedAt, rowCount }: { dq: DataQuality; generatedAt: string; rowCount: number }) {
  const time = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const items = [
    dq.date_coverage && `Coverage: ${dq.date_coverage}`,
    dq.most_recent_date && `Latest: ${dq.most_recent_date}`,
    `${rowCount.toLocaleString()} rows`,
    `Refreshed ${time}`,
  ].filter(Boolean) as string[];
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded border px-3 py-1.5 text-[11px]
        ${dq.status === "ok" ? "border-slate-200 bg-slate-50 text-slate-400" : "border-amber-200 bg-amber-50 text-amber-600"}`}>
      {items.map((s) => <span key={s}>{s}</span>)}
      {dq.warnings.map((w, i) => <span key={i} className="font-medium">⚠ {w}</span>)}
    </div>
  );
}

// ── Executive headline ────────────────────────────────────────────────────────

function ExecutiveHeadline({ insights }: { insights: DashboardInsight[] }) {
  const top = insights.find((i) => i.severity === "critical" || i.severity === "high") ?? insights[0];
  if (!top) return null;
  const cfg = SEV_CFG[top.severity] ?? SEV_CFG.low;
  return (
    <div className={`border-l-4 bg-white rounded border border-slate-200 shadow-sm px-5 py-4 ${cfg.accent}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${cfg.tag}`}>
          {top.severity}
        </span>
        <p className="text-sm font-semibold text-slate-900">{top.headline}</p>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{top.finding}</p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
        <span><span className="font-medium text-slate-700">Driver: </span>{top.driver}</span>
        <span><span className="font-medium text-slate-700">Action: </span>{top.action}</span>
      </div>
    </div>
  );
}

// ── Compact metric tile ───────────────────────────────────────────────────────

function MetricTile({ metric }: { metric: DashboardMetric }) {
  const cfg = STATUS_CFG[metric.status] ?? STATUS_CFG.neutral;
  const hasDelta = metric.delta !== null && metric.delta_pct !== null;
  const up = (metric.delta ?? 0) >= 0;
  return (
    <div className={`border-l-4 bg-white rounded border border-slate-200 shadow-sm px-4 py-3 ${cfg.border}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 truncate mb-1">
        {metric.name}
      </p>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums leading-none ${cfg.value}`}>
          {metric.value % 1 === 0 ? metric.value : metric.value.toFixed(1)}
        </span>
        {hasDelta && (
          <span className={`text-xs font-semibold ${cfg.arrow}`}>
            {up ? "▲" : "▼"} {Math.abs(metric.delta_pct!).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {hasDelta && metric.prior_value !== null ? (
          <span className="text-[11px] text-slate-400">
            Prior: {metric.prior_value.toFixed(1)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">Baseline period</span>
        )}
        <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ring-inset capitalize ${cfg.pill}`}>
          {metric.status}
        </span>
      </div>
      <p className="text-[10px] text-slate-300 mt-0.5">{metric.count.toLocaleString()} records{metric.period ? ` · ${metric.period}` : ""}</p>
    </div>
  );
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function TrendChart({
  kpiName, series, insight, color,
}: {
  kpiName: string;
  series: Array<{ period: string; value: number }>;
  insight?: DashboardInsight;
  color: string;
}) {
  const avg = series.length ? series.reduce((s, p) => s + p.value, 0) / series.length : null;
  return (
    <div className="bg-white rounded border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-semibold text-slate-700 mb-0.5">{kpiName}</p>
      {insight && <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">{insight.finding}</p>}
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
          <XAxis dataKey="period" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
            itemStyle={{ color: "#334155" }}
          />
          {avg !== null && <ReferenceLine y={avg} stroke="#cbd5e1" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
        </LineChart>
      </ResponsiveContainer>
      {insight && (
        <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100 leading-relaxed">
          <span className="font-medium text-slate-600">Takeaway: </span>{insight.evidence}
        </p>
      )}
    </div>
  );
}

// ── Driver bar chart ──────────────────────────────────────────────────────────

function DriverChart({
  dim, kpiName, breakdown, color,
}: {
  dim: string;
  kpiName: string;
  breakdown: Array<{ name: string; value: number }>;
  color: string;
}) {
  const avg = breakdown.length ? breakdown.reduce((s, r) => s + r.value, 0) / breakdown.length : null;
  const barHeight = Math.max(120, Math.min(breakdown.length * 22, 320));
  return (
    <div className="bg-white rounded border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-semibold text-slate-700 mb-0.5">
        {kpiName} <span className="text-slate-400 font-normal">· by {dim}</span>
      </p>
      <ResponsiveContainer width="100%" height={barHeight}>
        <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
          <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
            itemStyle={{ color: "#334155" }}
          />
          {avg !== null && <ReferenceLine x={avg} stroke="#cbd5e1" strokeDasharray="3 3" />}
          <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Insight row ───────────────────────────────────────────────────────────────

function InsightRow({ insight }: { insight: DashboardInsight }) {
  const cfg = SEV_CFG[insight.severity] ?? SEV_CFG.low;
  return (
    <div className={`border-l-4 bg-white rounded border border-slate-200 shadow-sm overflow-hidden ${cfg.accent}`}>
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset ${cfg.tag}`}>
          {insight.severity}
        </span>
        <p className="text-xs font-semibold text-slate-800">{insight.headline}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-100">
        {[
          ["Finding",  insight.finding],
          ["Evidence", insight.evidence],
          ["Driver",   insight.driver],
          ["Impact",   insight.impact],
          ["Decision", insight.decision],
          ["Action",   insight.action],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-4 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  options,
  active,
  onChange,
  loading,
}: {
  options: Record<string, string[]>;
  active: Record<string, string>;
  onChange: (col: string, val: string) => void;
  loading: boolean;
}) {
  const cols = Object.keys(options);
  if (!cols.length) return null;
  const hasActive = Object.values(active).some(Boolean);
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-slate-200 bg-white px-4 py-2.5 shadow-sm transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 shrink-0">
        Filter
      </span>
      {cols.map((col) => (
        <div key={col} className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 capitalize">{col.replace(/_/g, " ")}</span>
          <select
            value={active[col] ?? ""}
            onChange={(e) => onChange(col, e.target.value)}
            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
          >
            <option value="">All</option>
            {options[col].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      ))}
      {hasActive && (
        <button
          onClick={() => cols.forEach((col) => onChange(col, ""))}
          className="ml-auto text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
        >
          Clear all ×
        </button>
      )}
      {loading && <span className="text-[10px] text-slate-400 animate-pulse">Updating…</span>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage({ params }: PageProps) {
  const { recipeId } = use(params);
  const router = useRouter();

  const [recipe, setRecipe]             = useState<RecipeResponse | null>(null);
  const [data, setData]                 = useState<DashboardData | null>(null);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [loading, setLoading]           = useState(true);
  const [filtering, setFiltering]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const [view, setView] = useState<"classic" | "enhanced">("classic");

  useEffect(() => {
    const stored = localStorage.getItem("bgo_dashboard_view") as "classic" | "enhanced" | null;
    if (stored === "enhanced" || stored === "classic") setView(stored);
  }, []);

  const handleViewChange = (v: "classic" | "enhanced") => {
    setView(v);
    localStorage.setItem("bgo_dashboard_view", v);
  };

  // Initial load: recipe + unfiltered data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getRecipe(Number(recipeId)), api.getDashboardData(Number(recipeId))])
      .then(([r, d]) => {
        if (!cancelled) {
          setRecipe(r);
          setData(d);
          setFilterOptions(d.filter_options ?? {});
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recipeId]);

  // Re-fetch data when filters change (skip initial mount)
  const isFirstFilterRender = useState(true);
  useEffect(() => {
    if (isFirstFilterRender[0]) { isFirstFilterRender[1](false); return; }
    let cancelled = false;
    setFiltering(true);
    api.getDashboardData(Number(recipeId), activeFilters)
      .then((d) => { if (!cancelled) { setData(d); setFilterOptions(d.filter_options ?? {}); } })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setFiltering(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters]);

  if (loading) return <Spinner />;
  if (error)   return <ErrorBox msg={error} />;
  if (!data || !recipe) return null;

  const hasData = data.metrics.length > 0 || Object.keys(data.time_series).length > 0;
  const insightFor = (kpiName: string) =>
    data.insights.find((ins) => ins.headline.startsWith(kpiName));

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

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6 bg-slate-50 min-h-screen">

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
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ring-1 ring-inset
            ${data.approved
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
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

      {/* Filter bar */}
      {Object.keys(filterOptions).length > 0 && (
        <FilterBar
          options={filterOptions}
          active={activeFilters}
          onChange={(col, val) =>
            setActiveFilters((prev) => ({ ...prev, [col]: val }))
          }
          loading={filtering}
        />
      )}

      {/* Freshness */}
      {data.data_quality && (
        <FreshnessStrip dq={data.data_quality} generatedAt={data.generated_at} rowCount={data.row_count} />
      )}

      {!hasData ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-amber-800">No chart data available</p>
          <p className="mt-1 text-xs text-amber-600">Verify KPI formulas reference columns in your data.</p>
          <button
            onClick={() => router.push(`/recipe/${recipeId}`)}
            className="mt-4 rounded bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
          >Edit recipe</button>
        </div>
      ) : (
        <>
          {/* Executive summary */}
          {data.insights.length > 0 && <ExecutiveHeadline insights={data.insights} />}

          {/* KPI scorecards */}
          {data.metrics.length > 0 && (
            <section>
              <SectionHeading>KPI Scorecards</SectionHeading>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                {data.metrics.map((m) => <MetricTile key={m.id} metric={m} />)}
              </div>
            </section>
          )}

          {/* Trend over time */}
          {Object.keys(data.time_series).length > 0 && (
            <section>
              <SectionHeading>Trend Over Time</SectionHeading>
              <div className="grid gap-4 lg:grid-cols-2">
                {Object.entries(data.time_series).map(([kpiName, series], i) => (
                  <TrendChart
                    key={kpiName}
                    kpiName={kpiName}
                    series={series}
                    insight={insightFor(kpiName)}
                    color={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Driver analysis */}
          {Object.keys(data.dimension_breakdowns).length > 0 && (
            <section>
              <SectionHeading>Driver Analysis</SectionHeading>
              <div className="space-y-4">
                {Object.entries(data.dimension_breakdowns).map(([dim, kpis]) => (
                  <div key={dim} className="grid gap-4 lg:grid-cols-2">
                    {Object.entries(kpis).map(([kpiName, breakdown], i) => (
                      <DriverChart
                        key={kpiName}
                        dim={dim}
                        kpiName={kpiName}
                        breakdown={breakdown}
                        color={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Insights */}
          {data.insights.length > 0 && (
            <section>
              <SectionHeading>Insights &amp; Recommended Actions</SectionHeading>
              <div className="space-y-3">
                {data.insights.map((ins, i) => <InsightRow key={i} insight={ins} />)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-slate-50">
      <div className="text-center">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="mt-3 text-xs text-slate-400">Loading dashboard…</p>
      </div>
    </main>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{msg}</div>
    </main>
  );
}
