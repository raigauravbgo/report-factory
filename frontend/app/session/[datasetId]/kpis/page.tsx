"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import type { KpiSuggestion } from "@/lib/types";

const DOMAIN_STYLES: Record<string, string> = {
  collections: "bg-caution/10 text-caution border-caution/20",
  cx:          "bg-azure/10 text-azure border-azure/20",
  sales:       "bg-grow/10 text-grow border-grow/20",
  workforce:   "bg-royal/10 text-royal border-royal/20",
  ops:         "bg-wash text-dim border-rim",
  custom:      "bg-signal/10 text-signal border-signal/20",
};

const CONF_STYLE = (c: number) =>
  c >= 0.85 ? "text-grow" : c >= 0.65 ? "text-caution" : "text-mist";

export default function KpisPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<KpiSuggestion[]>([]);
  const [selected, setSelected] = useState<KpiSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [comment, setComment] = useState<Record<string, string>>({});
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customFormula, setCustomFormula] = useState("");
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  useEffect(() => {
    let uploadIds: number[] = [];
    try {
      const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
      if (stored) uploadIds = (JSON.parse(stored) as { uploadId: number }[]).map((u) => u.uploadId);
    } catch { /* ignore */ }

    let interviewAnswers = {};
    try {
      const raw = sessionStorage.getItem(`dataset_${datasetId}_interview`);
      if (raw) interviewAnswers = JSON.parse(raw);
    } catch { /* ignore */ }

    api.getKpiSuggestions(Number(datasetId), uploadIds, interviewAnswers).then((res) => {
      setSuggestions(res);
      setSelected(res.filter((k) => k.confidence >= 0.75).slice(0, 8));
      setLoading(false);
    }).catch((e) => {
      setKpiError(String(e));
      setLoading(false);
    });
  }, [datasetId, retryCount]);

  const domains = ["all", ...Array.from(new Set(suggestions.map((s) => s.domain || "other")))];

  const available = suggestions.filter((s) => {
    if (selected.some((sel) => sel.kpi_id === s.kpi_id)) return false;
    if (domainFilter !== "all" && s.domain !== domainFilter) return false;
    if (search && !s.display_name.toLowerCase().includes(search.toLowerCase())
      && !s.formula.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const addKpi = (kpi: KpiSuggestion) => {
    setSelected((p) => [...p, kpi]);
    logEvent("kpi_selected", "kpis", { kpi_id: kpi.kpi_id, display_name: kpi.display_name, confidence: kpi.confidence, domain: kpi.domain }, { datasetId: Number(datasetId) });
  };
  const removeKpi = (id: string) => {
    const kpi = selected.find((k) => k.kpi_id === id);
    setSelected((p) => p.filter((k) => k.kpi_id !== id));
    if (kpi) logEvent("kpi_deselected", "kpis", { kpi_id: id, display_name: kpi.display_name }, { datasetId: Number(datasetId) });
  };
  const selectAll = () => setSelected([...suggestions]);
  const deselectAll = () => setSelected([]);

  const addCustom = () => {
    if (!customName.trim() || !customFormula.trim()) return;
    const kpi: KpiSuggestion = {
      kpi_id: `custom_${Date.now()}`,
      display_name: customName.trim(),
      formula: customFormula.trim(),
      confidence: 1,
      matched_columns: {},
      source: "interview" as const,
      domain: "custom",
    };
    setSelected((p) => [...p, kpi]);
    logEvent("custom_kpi_created", "kpis", { name: kpi.display_name, formula: kpi.formula }, { datasetId: Number(datasetId) });
    setCustomName("");
    setCustomFormula("");
    setAddingCustom(false);
  };

  const cancelCustom = () => {
    setCustomName("");
    setCustomFormula("");
    setAddingCustom(false);
  };

  const onDragStart = (i: number) => { dragItem.current = i; };
  const onDragEnter = (i: number) => { dragOver.current = i; };
  const onDragEnd = () => { dragItem.current = null; dragOver.current = null; };
  const onDrop = () => {
    if (dragItem.current === null || dragOver.current === null) return;
    const from = dragItem.current;
    const to = Math.max(0, Math.min(dragOver.current, selected.length - 1));
    const reordered = [...selected];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setSelected(reordered);
    logEvent("kpi_reordered", "kpis", { from_index: from, to_index: to, kpi_id: moved.kpi_id }, { datasetId: Number(datasetId) });
    dragItem.current = null;
    dragOver.current = null;
  };

  function handleContinue() {
    if (selected.length === 0) return;
    sessionStorage.setItem(`dataset_${datasetId}_selected_kpis`, JSON.stringify(selected));
    logEvent("kpis_confirmed", "kpis", {
      kpi_count: selected.length,
      kpi_ids: selected.map((k) => k.kpi_id),
    }, { datasetId: Number(datasetId) });
    router.push(`/session/${datasetId}/dimensions`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-rim px-6 py-4">
        <h1 className="text-[15px] font-bold text-ink tracking-tight">KPI Selection</h1>
        <p className="text-[11px] text-mist mt-0.5">Check KPIs for your dashboard. Drag to reorder the selected list.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 gap-3 text-dim text-[12px]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal border-t-transparent" />
          Finding matching KPIs…
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">

          {/* Left — available KPIs */}
          <div className="flex-1 flex flex-col border-r border-rim overflow-hidden">

            {/* Filters bar */}
            <div className="px-5 py-3 border-b border-rim space-y-2.5 bg-raised/50">
              <div className="flex flex-wrap gap-1.5">
                {domains.map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDomainFilter(d);
                      if (d !== "all") logEvent("domain_filter_applied", "kpis", { domain: d }, { datasetId: Number(datasetId) });
                    }}
                    className={`px-3 py-1 rounded-full text-[10px] font-semibold border capitalize transition-all
                      ${domainFilter === d
                        ? "bg-[#1B2340] text-white border-[#1B2340]"
                        : "bg-raised text-dim border-rim hover:border-edge hover:text-ink"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <svg viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-mist pointer-events-none">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search KPIs…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-[11px] border border-rim bg-raised rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-signal text-ink placeholder:text-mist"
                  />
                </div>
                <button onClick={selectAll} className="text-[10px] text-azure hover:underline whitespace-nowrap font-medium">Select all</button>
                <button onClick={deselectAll} className="text-[10px] text-mist hover:text-dim whitespace-nowrap">Deselect all</button>
              </div>
            </div>

            {/* KPI list */}
            <div className="flex-1 overflow-y-auto">
              {kpiError && (
                <div className="m-4 rounded-lg bg-danger/5 border border-danger/25 px-4 py-3 flex items-start justify-between gap-3">
                  <p className="text-[11px] text-danger">{kpiError}</p>
                  <button
                    onClick={() => { setKpiError(null); setLoading(true); setRetryCount((c) => c + 1); }}
                    className="text-[11px] text-signal hover:underline font-medium flex-shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!kpiError && available.length === 0 ? (
                <p className="p-5 text-[12px] text-mist">No KPIs match the current filter.</p>
              ) : !kpiError && (
                <ul className="divide-y divide-rim/50">
                  {available.map((kpi) => (
                    <li
                      key={kpi.kpi_id}
                      onClick={() => addKpi(kpi)}
                      onDoubleClick={() => setCommentOpen(commentOpen === kpi.kpi_id ? null : kpi.kpi_id)}
                      className="px-5 py-3.5 hover:bg-raised/60 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="mt-0.5 w-4 h-4 rounded border-2 border-rim group-hover:border-signal/50 transition-colors flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-ink truncate">{kpi.display_name}</p>
                            <p className="text-[10px] text-mist font-mono truncate mt-0.5">{kpi.formula}</p>
                            {commentOpen === kpi.kpi_id && (
                              <input
                                type="text"
                                placeholder="Add comment…"
                                value={comment[kpi.kpi_id] ?? ""}
                                onChange={(e) => setComment({ ...comment, [kpi.kpi_id]: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1.5 text-[11px] border border-rim bg-wash rounded px-2 py-1 w-full focus:outline-none focus:border-signal text-ink"
                                autoFocus
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-[10px] font-bold ${CONF_STYLE(kpi.confidence)}`}>
                            {Math.round(kpi.confidence * 100)}%
                          </span>
                          {kpi.domain && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold capitalize ${DOMAIN_STYLES[kpi.domain] ?? DOMAIN_STYLES.ops}`}>
                              {kpi.domain}
                            </span>
                          )}
                          {kpi.source === "interview" && (
                            <span className="text-[9px] bg-signal/10 text-signal border border-signal/20 px-1.5 py-0.5 rounded-full font-semibold">custom</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right — selected KPIs */}
          <div className="w-80 flex flex-col bg-raised/30 border-l border-rim">
            <div className="px-4 py-3 border-b border-rim bg-card flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink">Selected</span>
              <span className="text-[10px] font-mono text-mist bg-wash border border-rim rounded-full px-2 py-0.5">
                {selected.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selected.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-[11px] text-mist">Click KPIs on the left to add them here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-rim/40" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
                  {selected.map((kpi, i) => (
                    <li
                      key={kpi.kpi_id}
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragEnter={() => onDragEnter(i)}
                      onDragEnd={onDragEnd}
                      className="flex items-start gap-2.5 px-4 py-3 hover:bg-wash/40 cursor-grab active:cursor-grabbing transition-colors"
                    >
                      <span className="text-mist/40 mt-0.5 flex-shrink-0 text-[12px] select-none">⠿</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-ink truncate">{kpi.display_name}</p>
                        <p className="text-[10px] text-mist font-mono truncate mt-0.5">{kpi.formula}</p>
                        {comment[kpi.kpi_id] && (
                          <p className="text-[10px] text-dim italic mt-0.5">{comment[kpi.kpi_id]}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeKpi(kpi.kpi_id)}
                        className="text-mist/50 hover:text-danger text-base leading-none flex-shrink-0 mt-0.5 transition-colors"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Custom KPI form */}
            <div className="border-t border-rim bg-card">
              {addingCustom ? (
                <div className="p-4 space-y-2.5 bg-signal/5 border-t border-signal/15">
                  <p className="text-[10px] font-bold text-signal uppercase tracking-[0.1em]">New custom KPI</p>
                  <input
                    type="text"
                    autoFocus
                    placeholder="KPI name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addCustom(); if (e.key === "Escape") cancelCustom(); }}
                    className="w-full text-[11px] border border-rim bg-raised rounded-lg px-2.5 py-2 focus:outline-none focus:border-signal text-ink"
                  />
                  <input
                    type="text"
                    placeholder="Formula, e.g. revenue / contacts"
                    value={customFormula}
                    onChange={(e) => setCustomFormula(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addCustom(); if (e.key === "Escape") cancelCustom(); }}
                    className="w-full text-[11px] border border-rim bg-raised rounded-lg px-2.5 py-2 focus:outline-none focus:border-signal font-mono text-ink"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={addCustom}
                      disabled={!customName.trim() || !customFormula.trim()}
                      className="text-[11px] text-signal font-semibold hover:underline disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button onClick={cancelCustom} className="text-[11px] text-mist hover:text-dim">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3">
                  <button
                    onClick={() => setAddingCustom(true)}
                    className="text-[11px] text-signal/70 hover:text-signal font-medium transition-colors flex items-center gap-1"
                  >
                    <span>+</span> Add custom KPI
                  </button>
                </div>
              )}
            </div>

            {/* Continue button */}
            <div className="border-t border-rim p-4 bg-card">
              <button
                onClick={handleContinue}
                disabled={selected.length === 0}
                className={`w-full py-2.5 rounded-xl text-[12px] font-semibold transition-all
                  ${selected.length > 0
                    ? "bg-signal text-white hover:bg-signal/90 shadow-sm"
                    : "bg-raised text-mist cursor-not-allowed border border-rim"}`}
              >
                {`Continue to Dimensions (${selected.length} KPIs) →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
