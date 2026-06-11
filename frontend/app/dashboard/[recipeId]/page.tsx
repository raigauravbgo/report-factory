"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush,
} from "recharts";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import { formatKpiValue, formatAxisValue } from "@/lib/format";
import KpiSummaryCard from "@/components/kpis/KpiSummaryCard";
import ChartCard from "@/components/ui/ChartCard";
import SectionHeader from "@/components/ui/SectionHeader";
import InsightPanel from "@/components/ui/InsightPanel";
import FilterBar from "@/components/filters/FilterBar";
import type { RecipeConfig } from "@/lib/types";

interface KpiSummary { name: string; value: number | null; formula: string; format?: string }
interface TimeSeriesPoint { date: string; value: number }
interface BreakdownPoint { label: string; value: number }
interface TimeSeries { kpi: string; data: TimeSeriesPoint[] }
interface Breakdown { kpi: string; dimension: string; data: BreakdownPoint[] }
interface Insight { severity: "critical"|"high"|"medium"|"low"; headline: string; finding: string; action?: string }

interface DashboardData {
  recipe_id: number;
  config: RecipeConfig;
  kpi_summaries: KpiSummary[];
  time_series: TimeSeries[];
  breakdown: Breakdown[];
  insights: Insight[];
  generated_at: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COLORS = ["#3b82f6", "#00B5AD", "#f59e0b", "#ef4444", "#8b5cf6"];

// ── TrendChart ──────────────────────────────────────────────────────────────
// Extracted into its own component so it can own a `chartReady` state.
// The Brush is only mounted after ResponsiveContainer fires onResize with a
// positive width — this prevents the Recharts layout store from propagating
// NaN x/width into the Brush's scale before measurement is complete.

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

// M4: Error boundary catches Recharts crashes so one bad chart doesn't take down the page
class ChartErrorBoundary extends (require("react") as typeof import("react")).Component<
  { children: import("react").ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: import("react").ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <p className="text-sm text-gray-400 py-8 text-center">Chart failed to render.</p>;
    }
    return this.props.children;
  }
}

function TrendChart({ ts, formula, fmt, color, zoom, onZoomIn, onZoomOut, onResetZoom, onBrushChange }: TrendChartProps) {
  const cleanData = ts.data.map((d) => ({
    ...d,
    value: Number.isFinite(d.value) ? d.value : null,
  }));

  const safeStart = Number.isFinite(zoom.start) ? Math.min(zoom.start, ts.data.length - 1) : 0;
  const safeEnd   = Number.isFinite(zoom.end)   ? Math.min(zoom.end,   ts.data.length - 1) : ts.data.length - 1;

  // A stable key forces LineChart to remount whenever the data identity changes.
  // This ensures <Brush> is always part of the *initial* render of the chart so
  // Recharts computes its layout offsets correctly from the start — preventing the
  // "NaN for x / width / x1 / x2" warnings that occur when Brush is added to an
  // already-mounted chart whose ResizeObserver hasn't fired yet.
  const chartKey = `${ts.kpi}-${ts.data.length}`;

  return (
    <>
      <div className="flex gap-1 justify-end mb-1">
        <button onClick={onZoomIn} title="Zoom in" className="px-2 py-0.5 rounded text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium">＋</button>
        <button onClick={onZoomOut} title="Zoom out" className="px-2 py-0.5 rounded text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium">－</button>
        <button onClick={onResetZoom} title="Reset zoom" className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-600">Reset</button>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart key={chartKey} data={cleanData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatAxisValue(v, formula, fmt)} />
          <Tooltip formatter={(v: unknown) => formatKpiValue(v as number, formula, fmt)} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          {ts.data.length > 2 && (
            <Brush
              dataKey="date"
              height={28}
              travellerWidth={8}
              startIndex={safeStart}
              endIndex={safeEnd}
              onChange={({ startIndex, endIndex }) =>
                onBrushChange(
                  Number.isFinite(startIndex) ? startIndex! : 0,
                  Number.isFinite(endIndex)   ? endIndex!   : ts.data.length - 1,
                )
              }
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

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
  // Granularity override — null means use recipe default
  const [activeGranularity, setActiveGranularity] = useState<string | null>(null);

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

  // Initial load — recipe metadata + filter option values
  useEffect(() => {
    Promise.all([
      api.getRecipe(Number(recipeId)),
      fetch(`${BASE_URL}/api/dashboard/${recipeId}/filter-values`).then((r) => r.ok ? r.json() : {}),
    ])
      .then(([recipe, opts]) => {
        setApprovedAt(recipe.approved_at);
        setFilterOptions(opts as Record<string, string[]>);
      })
      .catch(() => {});
  }, [recipeId]);

  // Fetch dashboard data — re-runs whenever activeFilters or activeGranularity changes
  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (activeGranularity) params.set("granularity", activeGranularity);
    const url = `${BASE_URL}/api/dashboard/${recipeId}/data${params.size ? `?${params}` : ""}`;

    setFiltering(true);
    setFilterError(null);
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json() as Promise<DashboardData>; })
      .then((d) => {
        setData(d);
        if (!data) {
          setError(null);
          const blankCount = d.kpi_summaries.filter((k) => k.value === null).length;
          logEvent("dashboard_loaded", "dashboard", { kpi_count: d.kpi_summaries.length, blank_count: blankCount }, { recipeId: Number(recipeId) });
        }
      })
      .catch((e) => {
        // If we already have data, show inline error instead of full-page crash
        if (data) setFilterError(String(e));
        else setError(String(e));
      })
      .finally(() => { setLoading(false); setFiltering(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#00B5AD] border-t-transparent" />
      <p className="text-sm text-gray-500">Computing dashboard…</p>
    </div>
  );

  if (error) return (
    <div className="p-8 space-y-4">
      <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">{error}</div>
      <button onClick={() => router.push("/upload")} className="text-sm text-[#00B5AD] underline">← Start over</button>
    </div>
  );

  if (!data) return null;

  const { config, kpi_summaries, time_series, breakdown, insights, generated_at } = data;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top header bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div>
          <h1 className="text-lg font-bold text-[#1B2340]">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Recipe #{recipeId} · {config.granularity} · {config.date_column}
            {approvedAt && (
              <span className="ml-2 text-[#00B5AD] font-medium">
                ✓ Approved {new Date(approvedAt).toLocaleDateString()}
              </span>
            )}
            <span className="ml-2 text-gray-300">· Updated {new Date(generated_at).toLocaleTimeString()}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Granularity toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
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
                    current === g
                      ? "bg-[#1B2340] text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
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
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            ↓ {exportingPptx ? "Exporting…" : "Export PPTX"}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            ↓ {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button
            onClick={() => router.push(`/recipe/${recipeId}`)}
            className="flex items-center gap-1.5 rounded-lg border border-[#1B2340] px-4 py-2 text-sm text-[#1B2340] hover:bg-[#1B2340] hover:text-white transition-colors"
          >
            ✎ Edit recipe
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
        <div className="flex items-center gap-2 bg-teal-50 border-b border-teal-100 px-6 py-2 text-xs text-teal-700">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
          Applying filter…
        </div>
      )}
      {filterError && !filtering && (
        <div className="flex items-center justify-between bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-700">
          <span>⚠ Filter error: {filterError}</span>
          <button onClick={() => setFilterError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 p-6 space-y-8">

        {/* Empty state when filters return no data */}
        {!filtering && kpi_summaries.length === 0 && Object.values(activeFilters).some(Boolean) && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-4xl text-gray-200">◎</div>
            <p className="text-sm font-medium text-gray-500">No data matches the selected filters.</p>
            <button
              onClick={() => { setActiveFilters({}); logEvent("filters_cleared", "dashboard", {}, { recipeId: Number(recipeId) }); }}
              className="text-sm text-[#00B5AD] underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* KPI scorecards */}
        <section className="space-y-3">
          <SectionHeader title="KPI Scorecards" subtitle={`${kpi_summaries.length} metrics computed`} />
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

        {/* Executive insights */}
        {insights?.length > 0 && (
          <section>
            <InsightPanel insights={insights} />
          </section>
        )}

        {/* M11: Warn when selected granularity produces no time series (dataset too coarse) */}
        {!filtering && activeGranularity && time_series.length === 0 && kpi_summaries.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
            No time series data for <strong>{activeGranularity}</strong> granularity.
            {" "}Try switching to a coarser option (e.g. Weekly or Monthly) if the data doesn&apos;t span enough days.
          </div>
        )}

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
            )}
          </>
        )}

        {/* Config summary */}
        <section className="space-y-3">
          <SectionHeader title="Configuration" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Date Column", value: config.date_column },
              { label: "Granularity", value: config.granularity },
              { label: "Dimensions", value: config.dimensions.join(", ") || "—" },
              { label: "Filters", value: config.filters.join(", ") || "None" },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{item.label}</p>
                <p className="text-sm font-medium text-gray-900 mt-1 truncate">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="pt-2 pb-6">
          <button
            onClick={() => router.push("/upload")}
            className="rounded-lg bg-[#1B2340] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#243057] transition-colors"
          >
            + New Report
          </button>
        </div>
      </div>
    </div>
  );
}
