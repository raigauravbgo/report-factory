"use client";

import React from "react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, LabelList,
  ReferenceLine,
} from "recharts";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import { formatKpiValue, formatAxisValue } from "@/lib/format";
import KpiSummaryCard from "@/components/kpis/KpiSummaryCard";
import ChartCard from "@/components/ui/ChartCard";
import SectionHeader from "@/components/ui/SectionHeader";
import InsightPanel from "@/components/ui/InsightPanel";
import FilterBar from "@/components/filters/FilterBar";
import type { DashboardData, DashboardInsight, DataQuality } from "@/lib/types";

// Classic-view local types
interface TimeSeriesPoint { date: string; value: number }
interface BreakdownPoint { label: string; value: number }
interface TimeSeries { kpi: string; data: TimeSeriesPoint[] }
interface Breakdown { kpi: string; dimension: string; data: BreakdownPoint[] }

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];
const CHART_COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E0E6F2",
  borderRadius: "8px",
  color: "#1B2340",
  fontSize: "11px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};
const CHART_LABEL_STYLE = { color: "#8B97B0", fontSize: "10px" };

// M4: Error boundary catches Recharts crashes so one bad chart doesn't take down the page
class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <p className="text-[11px] text-mist py-8 text-center">Chart failed to render.</p>;
    }
    return this.props.children;
  }
}

interface TrendChartProps {
  ts: TimeSeries;
  formula: string;
  fmt?: string;
  color: string;
  zoom: { start: number; end: number };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onBrushChange: (start: number, end: number) => void;
}

function TrendChart({ ts, formula, fmt, color, zoom, onZoomIn, onZoomOut, onResetZoom, onBrushChange }: TrendChartProps) {
  const cleanData = ts.data.map((d) => ({
    ...d,
    value: Number.isFinite(d.value) ? d.value : null,
  }));

  // Smart Y-axis: zoom in when values cluster near the top (e.g. QA score 90-100%)
  const numericVals = cleanData.map((d) => d.value).filter((v): v is number => v !== null && v > 0);
  const minVal = numericVals.length ? Math.min(...numericVals) : 0;
  const maxVal = numericVals.length ? Math.max(...numericVals) : 1;
  const range = maxVal - minVal;
  const yDomain: [number, number | string] =
    numericVals.length > 1 && range < maxVal * 0.25 && minVal > 0
      ? [Math.max(0, Math.floor(minVal * 0.97)), Math.ceil(maxVal * 1.03)]
      : [0, "auto"];

  const safeStart = Number.isFinite(zoom.start) ? Math.min(zoom.start, ts.data.length - 1) : 0;
  const safeEnd   = Number.isFinite(zoom.end)   ? Math.min(zoom.end,   ts.data.length - 1) : ts.data.length - 1;
  const chartKey  = `${ts.kpi}-${ts.data.length}`;
  const gradientId = `grad-${ts.kpi.replace(/\W/g, "_")}`;
  // Show individual dots only when few data points — too many dots get cluttered
  const showDots = ts.data.length <= 20;

  return (
    <>
      <div className="flex gap-1 justify-end mb-2">
        <button onClick={onZoomIn} title="Zoom in"
          className="px-2 py-0.5 rounded text-[10px] bg-raised hover:bg-wash text-dim font-mono border border-rim transition-colors font-semibold">＋</button>
        <button onClick={onZoomOut} title="Zoom out"
          className="px-2 py-0.5 rounded text-[10px] bg-raised hover:bg-wash text-dim font-mono border border-rim transition-colors font-semibold">－</button>
        <button onClick={onResetZoom} title="Reset zoom"
          className="px-2 py-0.5 rounded text-[10px] text-mist hover:text-dim transition-colors font-medium">Reset</button>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart key={chartKey} data={cleanData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#EDF0F8" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#8B97B0" }} tickLine={false} axisLine={false} />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 9, fill: "#8B97B0" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatAxisValue(v, formula, fmt)}
            width={44}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_LABEL_STYLE}
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
            formatter={(v: unknown) => [formatKpiValue(v as number, formula, fmt), ts.kpi.replace(/_/g, " ")]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={showDots ? { r: 3, fill: color, strokeWidth: 2, stroke: "#fff" } : false}
            activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive={false}
            connectNulls={false}
          />
          {ts.data.length > 2 && (
            <Brush
              dataKey="date"
              height={24}
              travellerWidth={8}
              startIndex={safeStart}
              endIndex={safeEnd}
              stroke="#C8D2E8"
              fill="#F8F9FD"

              onChange={({ startIndex, endIndex }) =>
                onBrushChange(
                  Number.isFinite(startIndex) ? startIndex! : 0,
                  Number.isFinite(endIndex)   ? endIndex!   : ts.data.length - 1,
                )
              }
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ENHANCED VIEW — constants, helpers, and components
// ══════════════════════════════════════════════════════════════════════════════

type TabId = "overview" | "trends" | "drivers" | "actions";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview",  icon: "📊" },
  { id: "trends",   label: "Trends",    icon: "📈" },
  { id: "drivers",  label: "Drivers",   icon: "🔍" },
  { id: "actions",  label: "Actions",   icon: "⚡" },
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

// ── helpers ───────────────────────────────────────────────────────────────────

function getInsightForKpi(
  insights: DashboardInsight[],
  kpiName: string,
): DashboardInsight | undefined {
  const lower = kpiName.toLowerCase();
  // Prefer synthetic summary insights (headline: "<KPI Name> at <value>")
  const synthetic = insights.find((ins) => {
    const h = ins.headline.toLowerCase();
    return h.startsWith(lower) && / at \d/.test(ins.headline);
  });
  return synthetic ?? insights.find((ins) => ins.headline.toLowerCase().includes(lower));
}


function deltaClass(delta: number | null, direction: string): string {
  if (delta === null) return "text-slate-400";
  const up = delta >= 0;
  const good = direction === "lower_is_better" ? !up : up;
  return good ? "text-emerald-600" : "text-red-600";
}

function dashboardTitle(kpis: Array<{ name: string }>): string {
  if (!kpis.length) return "Dashboard";
  const s = kpis.map((k) => k.name.replace(/_/g, " ")).join(" · ");
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

// ── SparkLine ─────────────────────────────────────────────────────────────────

function SparkLine({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 80, H = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 6) - 3,
  }));
  const pts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 80 24" className="w-full h-8 mt-2" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="2.5" fill={color} />
      ))}
    </svg>
  );
}

// ── EnhancedSectionHeading ────────────────────────────────────────────────────

function EnhancedSectionHeading({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-[9px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
        {children}
      </h2>
      <div className="flex-1 border-t border-slate-200" />
      {right}
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

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
            ${active === t.id
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

// ── InsightAside ──────────────────────────────────────────────────────────────

function InsightAside({ insight }: { insight: DashboardInsight }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2 border border-slate-200">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
        📌 Insight
      </div>
      {(["finding", "driver", "impact", "action"] as const).map((key) => {
        const val = insight[key];
        if (!val) return null;
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {key}
            </span>
            <span className="text-[11px] text-slate-700 leading-relaxed">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── DriverBarsSection ─────────────────────────────────────────────────────────

function DriverBarsSection({
  dim,
  kpiName,
  breakdown,
}: {
  dim: string;
  kpiName: string;
  breakdown: Array<{ name: string; value: number }>;
}) {
  if (!breakdown.length) return null;
  const avg = breakdown.reduce((s, r) => s + r.value, 0) / breakdown.length;
  const maxVal = Math.max(...breakdown.map((r) => r.value));
  const bottom = breakdown[breakdown.length - 1];
  const gap = (maxVal - bottom.value).toFixed(1);
  const title = `${kpiName.replace(/_/g, " ")} by ${dim} — ${breakdown[0].name} leads at ${maxVal.toFixed(1)}`;
  const subtitle = `Average: ${avg.toFixed(1)} · ${breakdown.length} segments · Gap: ${gap}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-3">
      <div className="text-xs font-bold text-slate-800 mb-0.5 leading-snug">{title}</div>
      <div className="text-[10px] text-slate-400 mb-2">{subtitle}</div>
      <div className="overflow-y-auto max-h-56">
        {breakdown.map((row) => {
          const pct = maxVal > 0 ? (row.value / maxVal) * 100 : 0;
          const above = row.value >= avg;
          return (
            <div
              key={row.name}
              className="grid items-center gap-2 py-1 border-b border-slate-50 last:border-0"
              style={{ gridTemplateColumns: "120px 1fr 48px" }}
            >
              <span className="text-[10px] text-slate-600 font-medium truncate" title={row.name}>
                {row.name}
              </span>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${above ? "bg-emerald-500" : "bg-red-400"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-[10px] font-bold text-right ${above ? "text-emerald-700" : "text-red-600"}`}>
                {row.value.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ActionTable ───────────────────────────────────────────────────────────────

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
                className="text-left text-[9px] font-bold uppercase tracking-widest text-slate-400 px-3 py-2"
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
              <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2 w-20">
                  <span className={`flex items-center gap-1.5 text-[10px] font-bold capitalize ${p.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.dot}`} />
                    {ins.severity}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="text-xs font-semibold text-slate-900 mb-0.5">{ins.action ?? ins.headline}</div>
                  <div className="text-[10px] text-slate-500 leading-relaxed">{ins.finding}</div>
                </td>
                <td className="px-3 py-2 text-[10px] text-slate-700 w-32">{ins.impact}</td>
                <td className="px-3 py-2 text-[10px] text-slate-400 w-24">—</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── RootCauseCards ────────────────────────────────────────────────────────────

function RootCauseCards({ insights }: { insights: DashboardInsight[] }) {
  const top3 = [...insights]
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
    .slice(0, 3);
  const BORDERS = ["border-l-red-500", "border-l-amber-400", "border-l-slate-300"] as const;
  const LABELS  = ["text-red-600",     "text-amber-600",     "text-slate-400"]     as const;
  return (
    <div className={`grid gap-4 ${
      top3.length === 1 ? "grid-cols-1" :
      top3.length === 2 ? "grid-cols-1 md:grid-cols-2" :
      "grid-cols-1 md:grid-cols-3"
    }`}>
      {top3.map((ins, i) => (
        <div
          key={i}
          className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-4 ${BORDERS[i] ?? BORDERS[2]}`}
        >
          <div className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${LABELS[i] ?? LABELS[2]}`}>
            Root Cause #{i + 1}
          </div>
          <div className="text-xs font-bold text-slate-900 mb-1.5 leading-snug">{ins.headline}</div>
          <div className="text-[10px] text-slate-600 leading-relaxed">{ins.driver || ins.finding}</div>
        </div>
      ))}
    </div>
  );
}

// ── ExecutiveBanner ───────────────────────────────────────────────────────────

function ExecutiveBanner({ insights }: { insights: DashboardInsight[] }) {
  if (!insights.length) return null;
  const top =
    insights.find((i) => i.severity === "critical" || i.severity === "high") ?? insights[0];
  const cfg = SEV_BANNER[top.severity] ?? SEV_BANNER.low;
  return (
    <div className={`border-l-4 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 mb-4 ${cfg.border}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-base flex-shrink-0 mt-0.5">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-[9px] font-bold uppercase tracking-widest mb-0.5 ${cfg.label}`}>
            {top.severity}
          </div>
          <div className="text-sm font-bold text-slate-900 mb-1 leading-snug">{top.headline}</div>
          <div className="text-xs text-slate-600 leading-relaxed mb-2">{top.finding}</div>
          <div className="flex flex-wrap gap-1.5">
            {top.driver && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800">
                Driver: {top.driver}
              </span>
            )}
            {top.impact && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-50 text-red-800">
                Impact: {top.impact}
              </span>
            )}
            {top.action && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-800">
                Action: {top.action}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── EnhancedMetricTile ────────────────────────────────────────────────────────

function EnhancedMetricTile({
  metric,
  insight,
  sparkValues,
}: {
  metric: import("@/lib/types").DashboardMetric;
  insight?: DashboardInsight;
  sparkValues: number[];
}) {
  const hasDelta = metric.delta !== null && metric.delta_pct !== null;
  const up = (metric.delta ?? 0) >= 0;
  const dColor  = deltaClass(metric.delta, metric.direction);
  const topBorder = STATUS_TOP[metric.status]   ?? STATUS_TOP.neutral;
  const valColor  = STATUS_VAL2[metric.status]  ?? STATUS_VAL2.neutral;
  const badgeCls  = STATUS_BADGE2[metric.status] ?? STATUS_BADGE2.neutral;
  const interpCls = STATUS_INTERP[metric.status] ?? STATUS_INTERP.neutral;
  const sparkCol  = SPARK_COLOR[metric.status]   ?? SPARK_COLOR.neutral;
  const statusLabel =
    metric.status === "risk"
      ? "At Risk"
      : metric.status.charAt(0).toUpperCase() + metric.status.slice(1);

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-3 border-t-4 ${topBorder} hover:shadow-md transition-shadow`}>
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 truncate">
        {metric.name.replace(/_/g, " ")}
      </div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className={`text-2xl font-extrabold tabular-nums leading-none ${valColor}`}>
          {metric.value % 1 === 0 ? metric.value : metric.value.toFixed(1)}
        </span>
        {hasDelta && (
          Math.abs(metric.delta_pct!) < 0.05
            ? <span className="text-[10px] font-medium text-slate-400">No change</span>
            : <span className={`text-xs font-bold ${dColor}`}>
                {up ? "▲" : "▼"} {Math.abs(metric.delta_pct!).toFixed(1)}%
              </span>
        )}
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ring-inset capitalize ${badgeCls}`}>
          {statusLabel}
        </span>
        <span className="text-[9px] text-slate-400">{metric.period ?? ""}</span>
      </div>
      {metric.prior_value !== null && (
        <div className="text-[10px] text-slate-400 mb-1.5">
          Prior: {metric.prior_value.toFixed(1)}
        </div>
      )}
      {insight && (
        <div className={`text-[10px] leading-relaxed p-2 rounded-lg border-l-4 ${interpCls}`}>
          {insight.finding}
        </div>
      )}
      {sparkValues.length >= 2 && <SparkLine values={sparkValues} color={sparkCol} />}
      <div className="text-[9px] text-slate-300 mt-1">{metric.count.toLocaleString()} records</div>
    </div>
  );
}

// ── EnhancedFreshnessStrip ────────────────────────────────────────────────────

function EnhancedFreshnessStrip({
  dq,
  generatedAt,
  rowCount,
}: {
  dq: DataQuality;
  generatedAt: string;
  rowCount: number;
}) {
  const time = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const items = [
    dq.date_coverage && `Coverage: ${dq.date_coverage}`,
    dq.most_recent_date && `Latest: ${dq.most_recent_date}`,
    `${rowCount.toLocaleString()} rows`,
    `Refreshed ${time}`,
  ].filter(Boolean) as string[];
  const ok = dq.status === "ok";
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 px-6 py-2 text-[11px] border-b ${
      ok ? "bg-white text-slate-400 border-slate-200" : "bg-amber-50 text-amber-700 border-amber-200"
    }`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      {items.map((s) => <span key={s}>{s}</span>)}
      {dq.warnings.map((w, i) => (
        <span key={i} className="font-semibold">⚠ {w}</span>
      ))}
    </div>
  );
}

// ── EnhancedHeader ────────────────────────────────────────────────────────────

function EnhancedHeader({
  data,
  view,
  onViewChange,
  onEditRecipe,
}: {
  data: DashboardData;
  view: "classic" | "enhanced";
  onViewChange: (v: "classic" | "enhanced") => void;
  onEditRecipe: () => void;
}) {
  const title = dashboardTitle(data.config.kpis);
  const subtitle = [
    data.data_quality?.date_coverage,
    `${(data.row_count ?? 0).toLocaleString()} records`,
  ].filter(Boolean).join(" · ");

  return (
    <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-[13px] font-bold tracking-widest text-blue-300 uppercase shrink-0">BGO AI</span>
        <div className="w-px h-6 bg-slate-700 shrink-0" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-400 leading-tight truncate">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
          data.approved
            ? "bg-emerald-950 text-emerald-400 border-emerald-700"
            : "bg-amber-950 text-amber-400 border-amber-700"
        }`}>
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

// ── EnhancedDashboard ─────────────────────────────────────────────────────────

interface EnhancedDashboardProps {
  data: DashboardData;
  filterOptions: Record<string, string[]>;
  activeFilters: Record<string, string>;
  filtering: boolean;
  view: "classic" | "enhanced";
  onViewChange: (v: "classic" | "enhanced") => void;
  onFilterChange: (col: string, val: string) => void;
  onEditRecipe: () => void;
}

function EnhancedDashboard({
  data, filterOptions, activeFilters, filtering,
  view, onViewChange, onFilterChange, onEditRecipe,
}: EnhancedDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showAllDims, setShowAllDims] = useState(false);

  const insightFor = (kpiName: string) => getInsightForKpi(data.insights, kpiName);
  const sparkFor = (kpiName: string): number[] =>
    (data.time_series_dict?.[kpiName] ?? []).slice(-5).map((p) => p.value);
  const highSeverityCount = data.insights.filter(
    (i) => i.severity === "critical" || i.severity === "high",
  ).length;

  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Sticky header block */}
      <div className="sticky top-0 z-40">
        <EnhancedHeader
          data={data}
          view={view}
          onViewChange={onViewChange}
          onEditRecipe={onEditRecipe}
        />
        {data.data_quality && (
          <EnhancedFreshnessStrip
            dq={data.data_quality}
            generatedAt={data.generated_at}
            rowCount={data.row_count ?? 0}
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
              dimensions={data.config.dimensions ?? []}
              filters={data.config.filters ?? []}
              activeFilters={activeFilters}
              filterOptions={filterOptions}
              onFilterChange={onFilterChange}
            />
          </div>
        )}
        {filtering && (
          <div className="flex items-center gap-2 text-xs text-blue-600 mb-4">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Updating…
          </div>
        )}

        {/* ── Overview tab ── */}
        {activeTab === "overview" && (
          <div>
            <ExecutiveBanner insights={data.insights} />

            {data.metrics.length > 0 && (
              <section className="mb-5">
                <EnhancedSectionHeading>KPI Scorecards</EnhancedSectionHeading>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))" }}>
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

            {Object.keys(data.time_series_dict ?? {}).length > 0 && (
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
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(data.time_series_dict).map(([kpiName, series], i) => {
                    const ins = insightFor(kpiName);
                    const avg = series.length ? series.reduce((s, p) => s + p.value, 0) / series.length : null;
                    const metricVal = data.metrics.find((m) => m.name === kpiName)?.value;
                    return (
                      <div key={kpiName} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate pr-2">
                            {kpiName.replace(/_/g, " ")}
                          </span>
                          {metricVal !== undefined && (
                            <span className="text-sm font-extrabold text-slate-900 tabular-nums flex-shrink-0">
                              {metricVal % 1 === 0 ? metricVal : metricVal.toFixed(1)}
                            </span>
                          )}
                        </div>
                        {ins && (
                          <div className="text-[10px] text-slate-400 mb-3 leading-relaxed">{ins.finding}</div>
                        )}
                        <ResponsiveContainer width="100%" height={150}>
                          <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
                            <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
                            <XAxis dataKey="period" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={40} />
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }} itemStyle={{ color: "#334155" }} />
                            {avg !== null && <ReferenceLine y={avg} stroke="#cbd5e1" strokeDasharray="3 3" />}
                            <Line type="monotone" dataKey="value" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }} activeDot={{ r: 5, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── Trends tab ── */}
        {activeTab === "trends" && (
          <div>
            {Object.keys(data.time_series_dict ?? {}).length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">
                No trend data available. Ensure your recipe includes a date column and at least two time periods.
              </div>
            ) : (
              Object.entries(data.time_series_dict).map(([kpiName, series], i) => {
                const ins = insightFor(kpiName);
                const avg = series.length ? series.reduce((s, p) => s + p.value, 0) / series.length : null;
                const metricVal = data.metrics.find((m) => m.name === kpiName)?.value;
                return (
                  <div key={kpiName} className="flex gap-4 mb-5 items-start">
                    <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate pr-2">
                          {kpiName.replace(/_/g, " ")}
                        </span>
                        {metricVal !== undefined && (
                          <span className="text-sm font-extrabold text-slate-900 tabular-nums flex-shrink-0">
                            {metricVal % 1 === 0 ? metricVal : metricVal.toFixed(1)}
                          </span>
                        )}
                      </div>
                      {ins && <div className="text-[10px] text-slate-400 mb-3 leading-relaxed">{ins.finding}</div>}
                      <ResponsiveContainer width="100%" height={170}>
                        <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
                          <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" />
                          <XAxis dataKey="period" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={40} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }} itemStyle={{ color: "#334155" }} />
                          {avg !== null && <ReferenceLine y={avg} stroke="#cbd5e1" strokeDasharray="3 3" />}
                          <Line type="monotone" dataKey="value" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }} activeDot={{ r: 5, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {ins && <div className="w-52 flex-shrink-0"><InsightAside insight={ins} /></div>}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Drivers tab ── */}
        {activeTab === "drivers" && (
          <div>
            {Object.keys(data.dimension_breakdowns ?? {}).length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
                <div className="text-sm font-semibold text-amber-800 mb-1">No driver data available</div>
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
                      No significant variation across segments for <span className="font-medium">{dim}</span>
                    </p>
                  )}
                  <div className="grid gap-3 lg:grid-cols-2 items-start">
                    {Object.entries(data.dimension_breakdowns[dim]).map(([kpiName, breakdown]) => (
                      <DriverBarsSection
                        key={`${dim}-${kpiName}`}
                        dim={dim}
                        kpiName={kpiName}
                        breakdown={breakdown}
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

        {/* ── Actions tab ── */}
        {activeTab === "actions" && (
          <div>
            {data.insights.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">
                No insights available for this report. Add dimension data to generate recommendations.
              </div>
            ) : (
              <>
                <div className="text-xs text-slate-500 mb-4">
                  {data.insights.length} insight{data.insights.length !== 1 ? "s" : ""} · sorted by priority
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

// ══════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [zoomState, setZoomState] = useState<Record<string, { start: number; end: number }>>({});
  const [activeGranularity, setActiveGranularity] = useState<string | null>(null);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [view, setView] = useState<"classic" | "enhanced">(() => {
    if (typeof window === "undefined") return "classic";
    const stored = localStorage.getItem("bgo_dashboard_view");
    return (stored === "enhanced" || stored === "classic") ? stored : "classic";
  });

  const handleViewChange = (v: "classic" | "enhanced") => {
    setView(v);
    localStorage.setItem("bgo_dashboard_view", v);
  };

  function getZoom(kpiName: string, dataLength: number) {
    return zoomState[kpiName] ?? { start: 0, end: Math.max(0, dataLength - 1) };
  }
  function zoomIn(kpiName: string, dataLength: number) {
    const { start, end } = getZoom(kpiName, dataLength);
    const mid = Math.floor((start + end) / 2);
    const quarter = Math.max(1, Math.floor((end - start) / 4));
    setZoomState((z) => ({ ...z, [kpiName]: { start: Math.max(0, mid - quarter), end: Math.min(dataLength - 1, mid + quarter) } }));
    logEvent("chart_zoomed_in", "dashboard", { kpi: kpiName }, { recipeId: Number(recipeId) });
  }
  function zoomOut(kpiName: string, dataLength: number) {
    const { start, end } = getZoom(kpiName, dataLength);
    const expand = Math.max(1, Math.floor((end - start) / 2));
    setZoomState((z) => ({ ...z, [kpiName]: { start: Math.max(0, start - expand), end: Math.min(dataLength - 1, end + expand) } }));
    logEvent("chart_zoomed_out", "dashboard", { kpi: kpiName }, { recipeId: Number(recipeId) });
  }
  function resetZoom(kpiName: string) {
    setZoomState((z) => { const n = { ...z }; delete n[kpiName]; return n; });
  }

  useEffect(() => {
    api.getRecipe(Number(recipeId))
      .then((recipe) => setApprovedAt(recipe.approved_at))
      .catch(() => {});
  }, [recipeId]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const url = `${BASE_URL}/api/dashboard/${recipeId}/filter-values${params.size ? `?${params}` : ""}`;
    fetch(url)
      .then((r) => r.ok ? r.json() : {})
      .then((opts) => setFilterOptions(opts as Record<string, string[]>))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, activeFilters]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (activeGranularity) params.set("granularity", activeGranularity);
    const url = `${BASE_URL}/api/dashboard/${recipeId}/data${params.size ? `?${params}` : ""}`;

    const wasLoaded = !!data;
    void (async () => {
      setFiltering(true);
      setFilterError(null);
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`API ${r.status}`);
        const d = await r.json() as DashboardData;
        setData(d);
        if (!wasLoaded) {
          setError(null);
          const blankCount = d.kpi_summaries.filter((k) => k.value === null).length;
          logEvent("dashboard_loaded", "dashboard", { kpi_count: d.kpi_summaries.length, blank_count: blankCount }, { recipeId: Number(recipeId) });
        }
      } catch (e) {
        if (wasLoaded) setFilterError(String(e));
        else setError(String(e));
      } finally {
        setLoading(false);
        setFiltering(false);
      }
    })();
  }, [recipeId, activeFilters, activeGranularity]);

  function handleFilterChange(key: string, value: string) {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
    if (value) logEvent("filter_applied", "dashboard", { filter_key: key, filter_value: value }, { recipeId: Number(recipeId) });
    else logEvent("filter_cleared", "dashboard", { filter_key: key }, { recipeId: Number(recipeId) });
  }

  async function handleExport() {
    logEvent("export_clicked", "dashboard", { format: "excel" }, { recipeId: Number(recipeId) });
    setExporting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/dashboard/${recipeId}/export/excel`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_recipe_${recipeId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String(e)); }
    finally { setExporting(false); }
  }

  async function handleExportPptx() {
    logEvent("export_clicked", "dashboard", { format: "pptx" }, { recipeId: Number(recipeId) });
    setExportingPptx(true);
    try {
      const res = await fetch(`${BASE_URL}/api/dashboard/${recipeId}/export/pptx`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_recipe_${recipeId}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String(e)); }
    finally { setExportingPptx(false); }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(`${BASE_URL}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: Number(recipeId), name: templateName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || `API ${res.status}`);
      }
      setTemplateSaved(true);
      setShowSaveTemplate(false);
      setTemplateName("");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-10 h-10 rounded-full border-2 border-signal border-t-transparent animate-spin" />
      <p className="text-[12px] text-dim font-mono">Computing dashboard…</p>
    </div>
  );

  if (error) return (
    <div className="p-8 space-y-4">
      <div className="rounded-xl bg-danger/5 border border-danger/25 px-5 py-4 text-[12px] text-danger flex items-start gap-2">
        <span className="flex-shrink-0">⚠</span>
        <span>{error}</span>
      </div>
      <button onClick={() => router.push("/upload")} className="text-[12px] text-signal hover:underline">← Start over</button>
    </div>
  );

  if (!data) return null;

  // ── Enhanced View ────────────────────────────────────────────────────────────
  if (view === "enhanced") {
    return (
      <EnhancedDashboard
        data={data}
        filterOptions={filterOptions}
        activeFilters={activeFilters}
        filtering={filtering}
        view={view}
        onViewChange={handleViewChange}
        onFilterChange={(col, val) => setActiveFilters((prev) => ({ ...prev, [col]: val }))}
        onEditRecipe={() => router.push(`/recipe/${recipeId}`)}
      />
    );
  }
  // ── Classic View (unchanged below) ──────────────────────────────────────────

  const { config, kpi_summaries, time_series, breakdown, insights, generated_at } = data;

  const renderTimeSeries = (ts: TimeSeries, i: number) => {
    const kpi = kpi_summaries.find((k) => k.name === ts.kpi);
    const formula = kpi?.formula ?? "";
    const fmt = kpi?.format;
    // Color keyed to KPI index for consistency across sections
    const kpiIndex = kpi_summaries.findIndex((k) => k.name === ts.kpi);
    const color = COLORS[(kpiIndex >= 0 ? kpiIndex : i) % COLORS.length];
    const takeaway = ts.data.length > 1
      ? (() => {
          const first = ts.data[0]?.value ?? 0;
          const last = ts.data[ts.data.length - 1]?.value ?? 0;
          const diff = last - first;
          const dir = diff > 0 ? "increased" : diff < 0 ? "decreased" : "remained stable";
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
          <p className="text-[11px] text-mist py-8 text-center">No time series data. Try Daily or Weekly granularity.</p>
        ) : ts.data.length === 1 ? (
          <p className="text-[11px] text-mist py-8 text-center">
            Only 1 period — switch to <strong className="text-dim">Daily</strong> or <strong className="text-dim">Weekly</strong> for a trend view.
          </p>
        ) : (
          <ChartErrorBoundary>
            <TrendChart
              ts={ts} formula={formula} fmt={fmt}
              color={color}
              zoom={getZoom(ts.kpi, ts.data.length)}
              onZoomIn={() => zoomIn(ts.kpi, ts.data.length)}
              onZoomOut={() => zoomOut(ts.kpi, ts.data.length)}
              onResetZoom={() => resetZoom(ts.kpi)}
              onBrushChange={(start, end) => setZoomState((z) => ({ ...z, [ts.kpi]: { start, end } }))}
            />
          </ChartErrorBoundary>
        )}
      </ChartCard>
    );
  };

  const renderBreakdown = (bk: Breakdown, i: number) => {
    const kpi = kpi_summaries.find((k) => k.name === bk.kpi);
    const formula = kpi?.formula ?? "";
    // Color is keyed to the KPI, not the chart index, so the same KPI is always the same color
    const kpiIndex = kpi_summaries.findIndex((k) => k.name === bk.kpi);
    const color = COLORS[(kpiIndex >= 0 ? kpiIndex : i) % COLORS.length];
    const top = bk.data[0];
    const takeaway = top ? `Top performer: ${top.label} at ${formatKpiValue(top.value, formula)}.` : undefined;
    const cleanData = bk.data.map((d) => ({ ...d, value: Number.isFinite(d.value) ? d.value : 0 }));

    // Smart Y-axis: zoom in when values cluster near the top (e.g. QA scores all 90-100%)
    const vals = cleanData.map((d) => d.value).filter((v) => v > 0);
    const minVal = vals.length ? Math.min(...vals) : 0;
    const maxVal = vals.length ? Math.max(...vals) : 1;
    const range = maxVal - minVal;
    // If all values are within 25% of the max, start axis near the minimum to show differences
    const yDomain: [number, number | string] =
      vals.length > 1 && range < maxVal * 0.25 && minVal > 0
        ? [Math.max(0, Math.floor(minVal * 0.97)), Math.ceil(maxVal * 1.03)]
        : [0, "auto"];

    const chartHeight = bk.data.length > 10 ? 250 : 220;
    return (
      <ChartCard
        key={`${bk.kpi}-${bk.dimension}`}
        title={`${bk.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} by ${bk.dimension}`}
        subtitle={`${bk.data.length} groups`}
        takeaway={takeaway}
      >
        {cleanData.length > 0 ? (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={cleanData}
              margin={{ top: 24, right: 8, left: 0, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#EDF0F8" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "#8B97B0" }}
                tickLine={false}
                axisLine={false}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 9, fill: "#8B97B0" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatAxisValue(v, formula)}
                width={44}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_LABEL_STYLE}
                cursor={{ fill: "rgba(200, 210, 232, 0.3)" }}
                formatter={(v: unknown) => [formatKpiValue(v as number, formula), bk.kpi.replace(/_/g, " ")]}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: unknown) => formatAxisValue(v as number, formula)}
                  style={{ fontSize: 9, fill: color, fontWeight: 700 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-mist py-8 text-center">No breakdown data available.</p>
        )}
      </ChartCard>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky header */}
      <div className="bg-card border-b border-rim px-6 py-4 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div>
          <h1 className="text-[15px] font-bold text-ink tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="text-[10px] text-mist font-mono">Recipe #{recipeId}</span>
            <span className="text-mist text-[10px]">·</span>
            <span className="text-[10px] text-mist font-mono">{config.granularity}</span>
            <span className="text-mist text-[10px]">·</span>
            <span className="text-[10px] text-mist font-mono">{config.date_column}</span>
            {approvedAt && (
              <>
                <span className="text-mist text-[10px]">·</span>
                <span className="text-[10px] text-grow font-semibold flex items-center gap-1">
                  <span>✓</span> Approved {new Date(approvedAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex rounded-lg border border-rim overflow-hidden text-xs">
            {(["classic", "enhanced"] as const).map((v) => (
              <button
                key={v}
                onClick={() => handleViewChange(v)}
                className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                  view === v ? "bg-signal text-white" : "bg-raised text-dim hover:text-ink hover:bg-wash"
                }`}
              >
                {v === "classic" ? "Classic" : "Enhanced ✦"}
              </button>
            ))}
          </div>

          {/* Granularity toggle */}
          <div className="flex rounded-lg border border-rim overflow-hidden text-[11px] font-semibold">
            {(["daily", "weekly", "monthly"] as const).map((g) => {
              const current = activeGranularity ?? data?.config?.granularity ?? "monthly";
              return (
                <button
                  key={g}
                  onClick={() => {
                    setActiveGranularity(g === data?.config?.granularity && !activeGranularity ? null : g);
                    logEvent("granularity_changed", "dashboard", { granularity: g }, { recipeId: Number(recipeId) });
                  }}
                  className={`px-3 py-1.5 capitalize transition-colors ${
                    current === g ? "bg-signal text-white" : "bg-raised text-dim hover:text-ink hover:bg-wash"
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>

          <button
            onClick={handleExportPptx}
            disabled={exportingPptx}
            className="flex items-center gap-1.5 rounded-lg border border-rim px-3.5 py-2 text-[11px] font-medium text-dim hover:text-ink hover:border-edge bg-raised disabled:opacity-40 transition-all"
          >
            <span>↓</span> {exportingPptx ? "Exporting…" : "PPTX"}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-rim px-3.5 py-2 text-[11px] font-medium text-dim hover:text-ink hover:border-edge bg-raised disabled:opacity-40 transition-all"
          >
            <span>↓</span> {exporting ? "Exporting…" : "Excel"}
          </button>
          <button
            onClick={() => router.push(`/recipe/${recipeId}`)}
            className="flex items-center gap-1.5 rounded-lg border border-rim px-3.5 py-2 text-[11px] font-medium text-signal hover:bg-signal/10 border-signal/30 transition-all"
          >
            ✎ Edit
          </button>
          <button
            onClick={() => { setShowSaveTemplate(true); setTemplateSaved(false); }}
            className="flex items-center gap-1.5 rounded-lg bg-[#00B5AD] hover:bg-[#00B5AD]/90 text-white px-3.5 py-2 text-[11px] font-semibold transition-all"
          >
            {templateSaved ? "✓ Saved" : "⊕ Save as Template"}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        dimensions={config.dimensions}
        filters={config.filters}
        activeFilters={activeFilters}
        filterOptions={filterOptions}
        onFilterChange={handleFilterChange}
      />

      {/* Filter status banners */}
      {filtering && (
        <div className="flex items-center gap-2 bg-signal/5 border-b border-signal/15 px-6 py-2 text-[11px] text-signal">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
          Applying filter…
        </div>
      )}
      {filterError && !filtering && (
        <div className="flex items-center justify-between bg-danger/5 border-b border-danger/20 px-6 py-2 text-[11px] text-danger">
          <span>⚠ Filter error: {filterError}</span>
          <button onClick={() => setFilterError(null)} className="ml-4 text-danger/50 hover:text-danger">✕</button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 p-6 space-y-8">

        {/* Executive headline — most critical insight surfaced at the top */}
        {insights?.length > 0 && (() => {
          const top = insights.find((i) => i.severity === "critical") ??
                      insights.find((i) => i.severity === "high") ??
                      insights[0];
          if (!top) return null;
          const isAlert = top.severity === "critical" || top.severity === "high";
          return (
            <div className={`rounded-xl border px-5 py-4 flex items-start gap-3
              ${isAlert ? "bg-caution/5 border-caution/25" : "bg-signal/5 border-signal/20"}`}>
              <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${isAlert ? "bg-caution" : "bg-signal"}`} />
              <div>
                <p className={`text-[11px] font-bold uppercase tracking-[0.1em] mb-1 ${isAlert ? "text-caution" : "text-signal"}`}>
                  {top.severity === "critical" ? "Critical Alert" : top.severity === "high" ? "Key Finding" : "Insight"}
                </p>
                <p className="text-[13px] font-semibold text-ink leading-snug">{top.headline}</p>
                {top.finding && top.finding !== top.headline && (
                  <p className="text-[11px] text-dim mt-1 leading-relaxed">{top.finding}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Empty state */}
        {!filtering && kpi_summaries.length === 0 && Object.values(activeFilters).some(Boolean) && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-full border-2 border-rim flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-mist">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-[13px] font-medium text-dim">No data matches the selected filters.</p>
            <button
              onClick={() => { setActiveFilters({}); logEvent("filters_cleared", "dashboard", {}, { recipeId: Number(recipeId) }); }}
              className="text-[12px] text-signal hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* KPI scorecards */}
        {kpi_summaries.length > 0 && (
          <section className="space-y-4">
            <SectionHeader
              title="KPI Scorecards"
              subtitle={`${kpi_summaries.length} metric${kpi_summaries.length !== 1 ? "s" : ""} computed`}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {kpi_summaries.map((kpi, i) => (
                <KpiSummaryCard
                  key={kpi.name}
                  label={kpi.name.replace(/_/g, " ")}
                  value={formatKpiValue(kpi.value, kpi.formula, kpi.format)}
                  formula={kpi.formula}
                  color={COLORS[i % COLORS.length]}
                />
              ))}
            </div>
          </section>
        )}

        {/* Executive insights — full detail after KPI overview */}
        {insights?.length > 1 && (
          <section>
            <InsightPanel insights={insights} />
          </section>
        )}

        {/* Granularity warning */}
        {!filtering && activeGranularity && time_series.length === 0 && kpi_summaries.length > 0 && (
          <div className="rounded-lg bg-caution/5 border border-caution/20 px-4 py-3 text-[11px] text-caution/80">
            No time series data for <strong className="text-caution">{activeGranularity}</strong> granularity.
            {" "}Try switching to a coarser option (e.g. Weekly or Monthly).
          </div>
        )}

        {/* Story sections / flat layout */}
        {config.sections && config.sections.length > 0 ? (
          config.sections.map((section) => {
            const sectionTimeSeries =
              section.chart_type === "line"
                ? time_series.filter((ts) => section.kpis.includes(ts.kpi))
                : [];
            const sectionBreakdown =
              section.chart_type === "bar"
                ? breakdown.filter((bk) => section.kpis.includes(bk.kpi))
                : [];
            if (sectionTimeSeries.length === 0 && sectionBreakdown.length === 0) return null;
            return (
              <section key={section.id} className="space-y-4">
                <SectionHeader
                  title={section.title}
                  subtitle={`${section.kpis.length} metric${section.kpis.length !== 1 ? "s" : ""}`}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  {sectionTimeSeries.map((ts, i) => renderTimeSeries(ts, i))}
                  {sectionBreakdown.map((bk, i) => renderBreakdown(bk, i))}
                </div>
              </section>
            );
          })
        ) : (
          <>
            {time_series.length > 0 && (
              <section className="space-y-4">
                <SectionHeader title="Trends Over Time" subtitle={`${config.granularity} granularity`} />
                <div className="grid gap-4 lg:grid-cols-2">
                  {time_series.map((ts, i) => renderTimeSeries(ts, i))}
                </div>
              </section>
            )}
            {breakdown.length > 0 && (
              <section className="space-y-4">
                <SectionHeader
                  title={
                    breakdown.every((b) => b.dimension === breakdown[0]?.dimension)
                      ? `Breakdown by ${breakdown[0]?.dimension?.replace(/_/g, " ")}`
                      : "Breakdown Analysis"
                  }
                  subtitle="Comparison across dimension values"
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  {breakdown.map((bk, i) => renderBreakdown(bk, i))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Config summary */}
        <section className="space-y-4">
          <SectionHeader title="Configuration" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Date Column", value: config.date_column },
              { label: "Granularity",  value: config.granularity },
              { label: "Dimensions",   value: config.dimensions.join(", ") || "—" },
              { label: "Filters",      value: Object.keys(filterOptions).join(", ") || "None" },
            ].map((item) => (
              <div key={item.label} className="bg-card rounded-xl border border-rim p-4">
                <p className="text-[9px] text-mist uppercase tracking-[0.1em] font-bold">{item.label}</p>
                <p className="text-[12px] font-medium text-dim mt-1 truncate font-mono">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="pb-6 flex items-center gap-3">
          <button
            onClick={() => router.push("/upload")}
            className="rounded-lg bg-signal text-white px-5 py-2.5 text-[12px] font-semibold hover:bg-signal/90 transition-colors shadow-sm"
          >
            + New Report
          </button>
          <span className="text-[10px] text-mist font-mono">
            Updated {new Date(generated_at).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Save as Template modal */}
      {showSaveTemplate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-ink font-bold text-[16px] mb-1">Save as Template</h2>
            <p className="text-mist text-[12px] mb-5">
              Give this dashboard configuration a name. Next time you upload similar files,
              you can reuse it and skip straight to the dashboard.
            </p>
            <label className="block text-[11px] font-semibold text-dim mb-1.5">Template name</label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. QA Monthly Report"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveTemplate(); if (e.key === "Escape") setShowSaveTemplate(false); }}
              className="w-full border border-rim rounded-lg px-3 py-2.5 text-[13px] text-ink focus:outline-none focus:border-signal mb-2"
            />
            <p className="text-[10px] text-mist mb-5">
              Saves: {data?.config?.kpis?.length ?? 0} KPIs · {data?.config?.dimensions?.length ?? 0} dimensions ·
              {data?.config?.filters?.length ?? 0} filters · {data?.config?.date_column} · {data?.config?.granularity}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSaveTemplate(false)}
                className="px-4 py-2 text-[12px] text-mist hover:text-dim transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate || !templateName.trim()}
                className="px-5 py-2 bg-signal hover:bg-signal/90 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg transition-colors"
              >
                {savingTemplate ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
