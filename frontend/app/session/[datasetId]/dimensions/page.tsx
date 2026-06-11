"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import type { DimensionColumn, InterviewResult, KpiSuggestion } from "@/lib/types";

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dimensions", "Dashboard"];
const ACTIVE_STEP = 4;

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

  useEffect(() => {
    const raw = sessionStorage.getItem(`dataset_${datasetId}_selected_kpis`);
    if (!raw || raw === "[]") setNoKpisWarning(true);
  }, [datasetId]);

  useEffect(() => {
    setLoading(true);
    setDimError(null);
    api
      .getDimensions(Number(datasetId))
      .then((dims) => {
        setDimensions(dims);
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

  const maxTableCount = dimensions.length > 0
    ? Math.max(...dimensions.map((d) => d.table_count ?? 1))
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-rim px-6 py-4">
        <h1 className="text-[15px] font-bold text-ink tracking-tight">Dimension Selection</h1>
        <p className="text-[11px] text-mist mt-0.5">
          Choose columns for chart breakdowns and filter dropdowns.
        </p>
      </div>

      {/* Step indicator */}
      <div className="bg-card border-b border-rim px-6 py-3">
        <div className="flex items-center gap-1.5">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors
                  ${i === ACTIVE_STEP
                    ? "bg-[#1B2340] text-white border-[#1B2340]"
                    : i < ACTIVE_STEP
                    ? "bg-grow/10 text-grow border-grow/25"
                    : "bg-raised text-mist border-rim"}`}
              >
                {i < ACTIVE_STEP ? (
                  <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
                {step}
              </div>
              {i < STEPS.length - 1 && <div className="w-3 h-px bg-rim flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* No KPIs warning */}
      {noKpisWarning && (
        <div className="mx-6 mt-4 rounded-lg bg-caution/5 border border-caution/20 px-4 py-3 text-[11px] text-caution flex items-center gap-3">
          <span>⚠</span>
          <span>No KPIs found from the previous step.</span>
          <button
            onClick={() => router.push(`/session/${datasetId}/kpis`)}
            className="underline font-semibold hover:text-caution/80 ml-auto"
          >
            ← Back to KPI Selection
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 gap-3 text-dim text-[12px]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal border-t-transparent" />
          Loading dimensions…
        </div>
      ) : dimError ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-[12px] text-danger">{dimError}</p>
          <button onClick={() => setRetryCount((n) => n + 1)} className="text-[11px] text-signal hover:underline">Retry</button>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">

          {/* Left — available dimensions */}
          <div className="flex-1 flex flex-col border-r border-rim overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rim bg-raised/30">
              <span className="text-[10px] font-bold text-mist uppercase tracking-[0.1em]">
                Available ({dimensions.length})
              </span>
              <div className="flex gap-3 text-[10px]">
                <button onClick={() => setSelected([...dimensions])}
                  className="text-signal hover:underline font-medium">Select all</button>
                <span className="text-mist/30">·</span>
                <button onClick={() => setSelected([])}
                  className="text-mist hover:text-dim">Deselect all</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {dimensions.map((dim) => {
                const isSelected = selected.some((d) => d.name === dim.name);
                const tc = dim.table_count ?? 1;
                const isAllTables = maxTableCount > 1 && tc === maxTableCount;
                const showBadge = maxTableCount > 1;
                return (
                  <button
                    key={dim.name}
                    onClick={() => toggle(dim)}
                    className={`w-full text-left flex items-start gap-3 px-3 py-3 rounded-lg border transition-all
                      ${isSelected
                        ? "border-signal/25 bg-signal/5"
                        : "border-transparent hover:bg-raised/60 hover:border-rim"}`}
                  >
                    <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                      ${isSelected ? "border-signal bg-signal" : "border-edge"}`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-canvas" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-ink font-mono">{dim.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-wash text-mist border border-rim">
                          {dim.unique_count} unique
                        </span>
                        {showBadge && (
                          isAllTables ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-signal/10 text-signal border border-signal/20 font-semibold">
                              all tables
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-azure/10 text-azure border border-azure/20">
                              {tc} table{tc !== 1 ? "s" : ""}
                            </span>
                          )
                        )}
                      </div>
                      {dim.sample_values.length > 0 && (
                        <p className="text-[10px] text-mist mt-0.5 truncate">
                          e.g. {dim.sample_values.slice(0, 3).join(", ")}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}

              {dimensions.length === 0 && (
                <p className="text-[12px] text-mist py-8 text-center">
                  No dimension columns found in the uploaded files.
                </p>
              )}
            </div>
          </div>

          {/* Right — selected dimensions */}
          <div className="w-72 flex flex-col bg-raised/20">
            <div className="px-4 py-3 border-b border-rim bg-card flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink">Selected</span>
              <span className="text-[10px] font-mono text-mist bg-wash border border-rim rounded-full px-2 py-0.5">
                {selected.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {selected.length === 0 ? (
                <p className="text-[11px] text-mist py-6 text-center">
                  No dimensions selected yet.
                </p>
              ) : (
                selected.map((dim, idx) => (
                  <div
                    key={dim.name}
                    className="flex items-center gap-2 bg-card border border-rim rounded-lg px-3 py-2.5 hover:border-edge transition-colors"
                  >
                    {idx === 0 && (
                      <span className="text-[8px] font-bold text-signal uppercase bg-signal/10 border border-signal/20 rounded px-1.5 py-0.5 flex-shrink-0 tracking-wide">
                        Primary
                      </span>
                    )}
                    <span className="flex-1 text-[11px] font-mono text-dim truncate">{dim.name}</span>
                    <button
                      onClick={() => removeSelected(dim.name)}
                      className="flex-shrink-0 text-mist/40 hover:text-danger transition-colors text-base leading-none"
                      aria-label={`Remove ${dim.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Generate button */}
            <div className="border-t border-rim p-4 bg-card space-y-2.5">
              {generateError && (
                <p className="rounded-lg bg-danger/5 border border-danger/20 px-3 py-2.5 text-[11px] text-danger break-words flex items-start gap-1.5">
                  <span className="flex-shrink-0">⚠</span>
                  {generateError}
                </p>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating || noKpisWarning}
                className={`w-full py-3 rounded-xl text-[12px] font-semibold transition-all
                  ${generating || noKpisWarning
                    ? "bg-raised text-mist cursor-not-allowed border border-rim"
                    : "bg-signal text-white hover:bg-signal/90 shadow-sm"}`}
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" />
                    Generating…
                  </span>
                ) : `Generate Dashboard (${selected.length} dim${selected.length !== 1 ? "s" : ""})`}
              </button>
              {selected.length === 0 && !generating && (
                <p className="text-[10px] text-mist text-center">
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
