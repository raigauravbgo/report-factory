"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
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

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6 bg-slate-50 min-h-screen">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <h1 className="text-lg font-semibold text-slate-900 tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
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
