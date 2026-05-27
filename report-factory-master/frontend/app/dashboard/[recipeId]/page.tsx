"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ChartCard from "@/components/ChartCard";
import KpiCard from "@/components/KpiCard";
import InsightPanel from "@/components/ui/InsightPanel";
import SectionHeader from "@/components/ui/SectionHeader";
import { api } from "@/lib/api";
import type { DashboardResult, KpiResult } from "@/lib/types";

const DarkSidebar = dynamic(() => import("@/components/layout/DarkSidebar"), { ssr: false });

// ── Date filter pills ─────────────────────────────────────────────────────────
const DATE_PRESETS = ["Current Month", "Prev Month", "YTD", "Rolling 12M"] as const;

// ── Loading skeleton ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-100" />
      <div className="h-7 w-32 animate-pulse rounded bg-gray-100" />
      <div className="mt-3 h-2 w-16 animate-pulse rounded bg-gray-100" />
    </div>
  );
}

// ── Main inner page ───────────────────────────────────────────────────────────
function DashboardPageInner() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const params = useSearchParams();
  const uploadId = Number(params.get("uploadId") ?? "0");

  const [status, setStatus] = useState<string>("analyzing");
  const [result, setResult] = useState<DashboardResult | null>(null);
  const [error, setError] = useState("");
  const [activePreset, setActivePreset] = useState("Current Month");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!uploadId) return;
    intervalRef.current = setInterval(async () => {
      try {
        const statusRes = await api.getAnalysisStatus(uploadId);
        setStatus(statusRes.status);
        if (statusRes.status === "complete") {
          clearInterval(intervalRef.current!);
          const dashRes = await api.getDashboard(uploadId);
          setResult(dashRes);
        } else if (statusRes.status === "failed") {
          clearInterval(intervalRef.current!);
          setError("Analysis failed. Please go back and try again.");
        }
      } catch (e) {
        clearInterval(intervalRef.current!);
        setError(String(e));
      }
    }, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [uploadId]);

  // ── Split KPIs ──────────────────────────────────────────────────────────────
  const scalars: KpiResult[] = result?.kpi_results.filter((r) => !r.breakdown && !r.error) ?? [];
  const charts: KpiResult[] = result?.kpi_results.filter(
    (r) => r.breakdown && Object.keys(r.breakdown).length > 0
  ) ?? [];
  const errors: KpiResult[] = result?.kpi_results.filter((r) => !!r.error) ?? [];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <DarkSidebar />

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold text-gray-900">Executive Dashboard</h1>
              <p className="text-xs text-gray-400">
                {result
                  ? `${result.kpi_results.length} KPIs · Upload #${uploadId}`
                  : "Loading analysis…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Date range pills */}
            <div className="mr-2 flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setActivePreset(p)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    activePreset === p
                      ? "bg-[#1B2340] text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Export buttons */}
            {result && (
              <>
                <a
                  href={api.exportExcel(uploadId)}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Excel
                </a>
                <a
                  href={api.exportPptx(uploadId)}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-[#00B5AD] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#009A93]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  PowerPoint
                </a>
              </>
            )}
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#F4F6FA] px-6 py-5">

          {/* ── Error state ── */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              <span className="font-semibold">Error: </span>{error}
            </div>
          )}

          {/* ── Loading state ── */}
          {!result && !error && (
            <>
              <div className="mb-6 flex items-center gap-3 rounded-xl border border-blue-100 bg-white px-5 py-4 shadow-sm">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {status === "analyzing" ? "Running analysis…" : `Status: ${status}`}
                  </p>
                  <p className="text-xs text-gray-400">
                    Processing your data through the medallion pipeline. This takes a few seconds.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            </>
          )}

          {/* ── Dashboard content ── */}
          {result && (
            <>
              {/* Insight / storytelling panel */}
              <InsightPanel kpis={result.kpi_results} />

              {/* KPI scalar cards */}
              {scalars.length > 0 && (
                <section className="mb-6">
                  <SectionHeader
                    title="Key Performance Indicators"
                    subtitle={`${scalars.length} metrics · current period`}
                  />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {scalars.map((r) => (
                      <KpiCard key={r.kpi_id} result={r} />
                    ))}
                  </div>
                </section>
              )}

              {/* Breakdown charts */}
              {charts.length > 0 && (
                <section className="mb-6">
                  <SectionHeader
                    title="Breakdowns & Trends"
                    subtitle={`${charts.length} chart${charts.length !== 1 ? "s" : ""}`}
                  />
                  <div className="grid gap-5 lg:grid-cols-2">
                    {charts.map((r) => (
                      <ChartCard key={r.kpi_id} result={r} />
                    ))}
                  </div>
                </section>
              )}

              {/* Computation errors */}
              {errors.length > 0 && (
                <section className="mb-6">
                  <SectionHeader
                    title={`Data Gaps (${errors.length})`}
                    subtitle="KPIs that could not be computed — missing columns or incompatible data"
                  />
                  <div className="overflow-hidden rounded-xl border border-amber-100 bg-white shadow-sm">
                    {errors.map((r, i) => (
                      <div
                        key={r.kpi_id}
                        className={`flex items-start gap-3 px-5 py-3 ${i < errors.length - 1 ? "border-b border-gray-50" : ""}`}
                      >
                        <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                          <span className="text-[10px] font-bold text-amber-600">!</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.error}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Footer stamp */}
              <p className="text-center text-[11px] text-gray-300">
                BGO Executive Dashboard · Analysis generated for Upload #{uploadId} · Recipe #{recipeId}
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#00B5AD] border-t-transparent" />
      </div>
    }>
      <DashboardPageInner />
    </Suspense>
  );
}
