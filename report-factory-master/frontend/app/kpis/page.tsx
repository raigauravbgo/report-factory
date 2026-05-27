"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import KpiSelector from "@/components/KpiSelector";
import StepIndicator from "@/components/ui/StepIndicator";
import SectionHeader from "@/components/ui/SectionHeader";
import { api } from "@/lib/api";
import type { KpiFeasibilityBlocked, KpiDefinition } from "@/lib/types";

const DarkSidebar = dynamic(() => import("@/components/layout/DarkSidebar"), { ssr: false });

function KpisPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const uploadId = Number(params.get("uploadId") ?? "0");
  const recipeId = Number(params.get("recipeId") ?? "0");

  const [availableKpis, setAvailableKpis] = useState<string[]>([]);
  const [blockedKpis, setBlockedKpis] = useState<KpiFeasibilityBlocked[]>([]);
  const [kpiMeta, setKpiMeta] = useState<Record<string, { name: string; domain: string }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!uploadId) return;
    Promise.all([api.getMapping(uploadId), api.getRegistryKpis()])
      .then(([mappingRes, registryRes]) => {
        const available = (mappingRes as any).available_kpis ?? [];
        const blocked = (mappingRes as any).blocked_kpis ?? [];
        setAvailableKpis(available);
        setBlockedKpis(blocked);
        setSelected(new Set(available));
        const meta: Record<string, { name: string; domain: string }> = {};
        for (const kpi of (registryRes.kpis as KpiDefinition[])) {
          meta[kpi.kpi_id] = { name: kpi.display_name, domain: kpi.domain };
        }
        setKpiMeta(meta);
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [uploadId]);

  function toggleKpi(kpiId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kpiId)) next.delete(kpiId); else next.add(kpiId);
      return next;
    });
  }

  async function handleRunAnalysis() {
    if (selected.size === 0) { setError("Select at least one KPI to analyse."); return; }
    setRunning(true);
    setError("");
    try {
      const res = await api.startAnalysis(uploadId, Array.from(selected));
      router.push(`/dashboard/${recipeId || res.recipe_id}?uploadId=${uploadId}`);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <DarkSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Select KPIs</h1>
            <p className="text-xs text-gray-400">
              Upload #{uploadId} · {loading ? "Loading…" : `${availableKpis.length} available · ${blockedKpis.length} blocked`}
            </p>
          </div>
          <StepIndicator current={4} />
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#F4F6FA] px-6 py-5">

          {loading ? (
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
              <span className="text-sm text-gray-500">Loading available KPIs…</span>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="mb-5 grid grid-cols-3 gap-3">
                {[
                  { label: "Available", value: availableKpis.length, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
                  { label: "Selected", value: selected.size, color: "text-[#00B5AD]", bg: "bg-white border-gray-100" },
                  { label: "Blocked", value: blockedKpis.length, color: "text-gray-400", bg: "bg-white border-gray-100" },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border ${s.bg} px-4 py-3 shadow-sm`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</p>
                    <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* KPI selection card */}
              <div className="mb-5 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <SectionHeader
                    title="Choose KPIs to Compute"
                    subtitle="Selected KPIs will be run through the medallion pipeline and rendered on your dashboard"
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={() => setSelected(new Set(availableKpis))}
                      className="font-semibold text-[#00B5AD] hover:underline"
                    >
                      Select all
                    </button>
                    <span className="text-gray-300">·</span>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <KpiSelector
                  availableKpis={availableKpis}
                  blockedKpis={blockedKpis}
                  kpiMeta={kpiMeta}
                  selected={selected}
                  onToggle={toggleKpi}
                />
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="font-semibold">Error: </span>{error}
                </div>
              )}

              {/* Action bar */}
              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                <button
                  onClick={() => router.push(`/mapping/${uploadId}`)}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Mapping
                </button>

                <button
                  onClick={handleRunAnalysis}
                  disabled={running || selected.size === 0}
                  className="flex items-center gap-2 rounded-lg bg-[#00B5AD] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#009A93] disabled:opacity-50"
                >
                  {running ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Starting analysis…
                    </>
                  ) : (
                    <>
                      Run Analysis ({selected.size} KPI{selected.size !== 1 ? "s" : ""})
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function KpisPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#00B5AD] border-t-transparent" />
      </div>
    }>
      <KpisPageInner />
    </Suspense>
  );
}
