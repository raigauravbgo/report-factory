"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { formatKpiValue, formatAxisValue } from "@/lib/format";
import KpiSummaryCard from "@/components/kpis/KpiSummaryCard";
import ChartCard from "@/components/ui/ChartCard";
import SectionHeader from "@/components/ui/SectionHeader";
import InsightPanel from "@/components/ui/InsightPanel";
import FilterBar from "@/components/filters/FilterBar";
import type { RecipeConfig } from "@/lib/types";

interface KpiSummary { name: string; value: number | null; formula: string }
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

export default function DashboardPage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_URL}/api/dashboard/${recipeId}/data`).then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json() as Promise<DashboardData>;
      }),
      api.getRecipe(Number(recipeId)),
    ])
      .then(([dashData, recipe]) => { setData(dashData); setApprovedAt(recipe.approved_at); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [recipeId]);

  async function handleExport() {
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
        <div className="flex gap-2">
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
        onFilterChange={(k, v) => setActiveFilters((prev) => ({ ...prev, [k]: v }))}
      />

      {/* Main content */}
      <div className="flex-1 p-6 space-y-8">

        {/* KPI scorecards */}
        <section className="space-y-3">
          <SectionHeader title="KPI Scorecards" subtitle={`${kpi_summaries.length} metrics computed`} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {kpi_summaries.map((kpi, i) => (
              <KpiSummaryCard
                key={kpi.name}
                label={kpi.name.replace(/_/g, " ")}
                value={formatKpiValue(kpi.value, kpi.formula)}
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

        {/* Trend charts */}
        {time_series.length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Trends Over Time" subtitle={`${config.granularity} granularity`} />
            <div className="grid gap-5 lg:grid-cols-2">
              {time_series.map((ts, i) => {
                const kpi = kpi_summaries.find((k) => k.name === ts.kpi);
                const formula = kpi?.formula ?? "";
                const takeaway = ts.data.length > 1
                  ? (() => {
                      const first = ts.data[0]?.value ?? 0;
                      const last = ts.data[ts.data.length - 1]?.value ?? 0;
                      const diff = last - first;
                      const dir = diff > 0 ? "increased" : diff < 0 ? "decreased" : "remained stable";
                      return `${ts.kpi.replace(/_/g, " ")} ${dir} from ${formatKpiValue(first, formula)} to ${formatKpiValue(last, formula)} over the period.`;
                    })()
                  : undefined;

                return (
                  <ChartCard
                    key={ts.kpi}
                    title={ts.kpi.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    subtitle={`${config.granularity} · ${ts.data.length} periods`}
                    takeaway={takeaway}
                  >
                    {ts.data.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={ts.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => formatAxisValue(v, formula)}
                          />
                          <Tooltip formatter={(v: unknown) => formatKpiValue(v as number, formula)} />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={COLORS[i % COLORS.length]}
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 py-8 text-center">No time series data available.</p>
                    )}
                  </ChartCard>
                );
              })}
            </div>
          </section>
        )}

        {/* Breakdown charts */}
        {breakdown.length > 0 && (
          <section className="space-y-3">
            <SectionHeader
              title={`Breakdown by ${breakdown[0]?.dimension?.replace(/_/g, " ")}`}
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
                        <BarChart data={bk.data} margin={{ top: 4, right: 8, left: 0, bottom: 36 }}>
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
                          <Bar dataKey="value" fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 py-8 text-center">No breakdown data available.</p>
                    )}
                  </ChartCard>
                );
              })}
            </div>
          </section>
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
