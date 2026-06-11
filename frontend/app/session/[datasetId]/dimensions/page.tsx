"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import type { DimensionColumn, InterviewResult, KpiSuggestion } from "@/lib/types";

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dimensions", "Dashboard"];
const ACTIVE_STEP = 4; // 0-based

export default function DimensionsPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();

  const [dimensions, setDimensions] = useState<DimensionColumn[]>([]);
  const [selected, setSelected] = useState<DimensionColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [dimError, setDimError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [noKpisWarning, setNoKpisWarning] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Check for KPIs saved by previous step
  useEffect(() => {
    const raw = sessionStorage.getItem(`dataset_${datasetId}_selected_kpis`);
    if (!raw || raw === "[]") setNoKpisWarning(true);
  }, [datasetId]);

  // Load available dimensions from backend
  useEffect(() => {
    setLoading(true);
    setDimError(null);
    api
      .getDimensions(Number(datasetId))
      .then((dims) => {
        setDimensions(dims);

        // Pre-selection: use interview-sourced dims if available, else select all
        let interviewDims: string[] = [];
        try {
          const raw = sessionStorage.getItem(`dataset_${datasetId}_interview`);
          if (raw) {
            const ir = JSON.parse(raw) as Partial<InterviewResult>;
            interviewDims = ir?.dimensions ?? [];
          }
        } catch { /* ignore */ }

        const initialSelected =
          interviewDims.length > 0
            ? dims.filter((d) => interviewDims.includes(d.name))
            : dims;
        setSelected(initialSelected);
        setLoading(false);
      })
      .catch((e) => {
        setDimError(String(e));
        setLoading(false);
      });
  }, [datasetId, retryCount]);

  function toggle(dim: DimensionColumn) {
    setSelected((prev) =>
      prev.some((d) => d.name === dim.name)
        ? prev.filter((d) => d.name !== dim.name)
        : [...prev, dim],
    );
  }

  function removeSelected(name: string) {
    setSelected((prev) => prev.filter((d) => d.name !== name));
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);

    let selectedKpis: KpiSuggestion[] = [];
    try {
      const raw = sessionStorage.getItem(`dataset_${datasetId}_selected_kpis`);
      if (raw) selectedKpis = JSON.parse(raw) as KpiSuggestion[];
    } catch { /* ignore */ }

    const confirmedRel = (() => {
      try {
        const raw = sessionStorage.getItem(`dataset_${datasetId}_relationships`);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    })();

    const interviewResult = (() => {
      try {
        const raw = sessionStorage.getItem(`dataset_${datasetId}_interview`);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    })();

    // Override dimensions with the user's explicit selection
    const patchedInterviewResult = {
      ...interviewResult,
      dimensions: selected.map((d) => d.name),
    };

    try {
      logEvent("generate_dashboard_clicked", "dimensions", {
        kpi_count: selectedKpis.length,
        dimension_count: selected.length,
        dimensions: selected.map((d) => d.name),
      }, { datasetId: Number(datasetId) });

      const res = await api.generateDashboard(
        Number(datasetId),
        selectedKpis,
        confirmedRel,
        patchedInterviewResult,
      );
      router.push(`/dashboard/${res.recipe_id}`);
    } catch (e) {
      setGenerateError(String(e));
      setGenerating(false);
    }
  }

  // Highest table_count across all returned dimensions (for "all tables" badge logic)
  const maxTableCount = dimensions.length > 0
    ? Math.max(...dimensions.map((d) => d.table_count ?? 1))
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-lg font-bold text-[#1B2340]">Dimension Selection</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Choose which columns to use for chart breakdowns and filter dropdowns.
        </p>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-2">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  i === ACTIVE_STEP
                    ? "bg-[#1B2340] text-white border-[#1B2340]"
                    : i < ACTIVE_STEP
                    ? "bg-teal-500 text-white border-teal-500"
                    : "bg-gray-100 text-gray-400 border-gray-100"
                }`}
              >
                {i < ACTIVE_STEP ? (
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
                {step}
              </div>
              {i < STEPS.length - 1 && <div className="w-4 h-px bg-gray-200" />}
            </div>
          ))}
        </div>
      </div>

      {/* No KPIs warning */}
      {noKpisWarning && (
        <div className="mx-6 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 flex items-center gap-3">
          <span>No KPIs found from the previous step.</span>
          <button
            onClick={() => router.push(`/session/${datasetId}/kpis`)}
            className="underline font-medium hover:text-amber-900"
          >
            ← Back to KPI Selection
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-sm text-gray-400">
          <span className="animate-spin h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full mr-3" />
          Loading dimensions…
        </div>
      ) : dimError ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-sm text-red-600">{dimError}</p>
          <button
            onClick={() => setRetryCount((n) => n + 1)}
            className="text-xs text-[#00B5AD] underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex-1 flex gap-0 overflow-hidden">

          {/* Left panel — available dimensions */}
          <div className="flex-1 flex flex-col border-r border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Available ({dimensions.length})
              </span>
              <div className="flex gap-3 text-xs text-[#00B5AD]">
                <button onClick={() => setSelected([...dimensions])} className="hover:underline">
                  Select all
                </button>
                <span className="text-gray-200">·</span>
                <button onClick={() => setSelected([])} className="hover:underline">
                  Deselect all
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              {dimensions.map((dim) => {
                const isSelected = selected.some((d) => d.name === dim.name);
                const tc = dim.table_count ?? 1;
                const isAllTables = maxTableCount > 1 && tc === maxTableCount;
                const showBadge = maxTableCount > 1;
                return (
                  <button
                    key={dim.name}
                    onClick={() => toggle(dim)}
                    className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-teal-200 bg-teal-50/60"
                        : "border-transparent hover:bg-gray-50"
                    }`}
                  >
                    {/* Checkbox */}
                    <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected ? "border-teal-500 bg-teal-500" : "border-gray-300"
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    {/* Column info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 font-mono">
                          {dim.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                          {dim.unique_count} unique
                        </span>
                        {showBadge && (
                          isAllTables ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-medium">
                              all tables
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                              {tc} table{tc !== 1 ? "s" : ""}
                            </span>
                          )
                        )}
                      </div>
                      {dim.sample_values.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          e.g. {dim.sample_values.slice(0, 3).join(", ")}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}

              {dimensions.length === 0 && (
                <p className="text-sm text-gray-400 py-8 text-center">
                  No dimension columns found in the uploaded files.
                </p>
              )}
            </div>
          </div>

          {/* Right panel — selected dimensions */}
          <div className="w-72 flex flex-col bg-gray-50/50">
            <div className="px-4 pt-4 pb-2 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Selected ({selected.length})
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {selected.length === 0 ? (
                <p className="text-xs text-gray-400 mt-4 text-center">
                  No dimensions selected yet.
                </p>
              ) : (
                selected.map((dim, idx) => (
                  <div
                    key={dim.name}
                    className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2"
                  >
                    {idx === 0 && (
                      <span className="text-[9px] font-bold text-teal-600 uppercase bg-teal-50 border border-teal-100 rounded px-1 flex-shrink-0">
                        Primary
                      </span>
                    )}
                    <span className="flex-1 text-xs font-mono text-gray-700 truncate">
                      {dim.name}
                    </span>
                    <button
                      onClick={() => removeSelected(dim.name)}
                      className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors text-base leading-none"
                      aria-label={`Remove ${dim.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Generate button */}
            <div className="border-t border-gray-100 p-4 bg-white space-y-2">
              {generateError && (
                <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 break-words">
                  {generateError}
                </p>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating || noKpisWarning}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#1B2340] text-white hover:bg-[#243060] disabled:opacity-40 transition-colors"
              >
                {generating
                  ? "Generating…"
                  : `Generate Dashboard (${selected.length} dim${selected.length !== 1 ? "s" : ""})`}
              </button>
              {selected.length === 0 && !generating && (
                <p className="text-xs text-gray-400 text-center">
                  Select at least one dimension to continue.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
