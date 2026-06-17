"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, LabelList,
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
const COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

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
              travellerStyle={{ fill: "#C8D2E8", strokeWidth: 0 }}
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
