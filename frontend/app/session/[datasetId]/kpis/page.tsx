"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { KpiSuggestion } from "@/lib/types";

const DOMAIN_COLORS: Record<string, string> = {
  collections: "bg-amber-50 text-amber-700 border-amber-100",
  cx: "bg-blue-50 text-blue-700 border-blue-100",
  sales: "bg-green-50 text-green-700 border-green-100",
  workforce: "bg-purple-50 text-purple-700 border-purple-100",
  ops: "bg-gray-50 text-gray-600 border-gray-100",
  custom: "bg-pink-50 text-pink-700 border-pink-100",
};

const CONF_COLOR = (c: number) =>
  c >= 0.85 ? "text-green-600" : c >= 0.65 ? "text-amber-600" : "text-gray-400";

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
  const [generating, setGenerating] = useState(false);

  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
    const uploadIds = stored
      ? (JSON.parse(stored) as { uploadId: number }[]).map((u) => u.uploadId)
      : [];
    const interviewAnswers = (() => {
      const raw = sessionStorage.getItem(`dataset_${datasetId}_interview`);
      return raw ? JSON.parse(raw) : {};
    })();

    api.getKpiSuggestions(Number(datasetId), uploadIds).then((res) => {
      setSuggestions(res);
      // Pre-select high-confidence items
      setSelected(res.filter((k) => k.confidence >= 0.75).slice(0, 8));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [datasetId]);

  const domains = ["all", ...Array.from(new Set(suggestions.map((s) => s.domain || "other")))];

  const available = suggestions.filter((s) => {
    const inSelected = selected.some((sel) => sel.kpi_id === s.kpi_id);
    if (inSelected) return false;
    if (domainFilter !== "all" && s.domain !== domainFilter) return false;
    if (search && !s.display_name.toLowerCase().includes(search.toLowerCase())
      && !s.formula.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const addKpi = (kpi: KpiSuggestion) => setSelected((p) => [...p, kpi]);
  const removeKpi = (id: string) => setSelected((p) => p.filter((k) => k.kpi_id !== id));
  const selectAll = () => setSelected([...suggestions]);
  const deselectAll = () => setSelected([]);

  const addCustom = () => {
    if (!customName.trim()) return;
    const kpi: KpiSuggestion = {
      kpi_id: `custom_${Date.now()}`,
      display_name: customName.trim(),
      formula: customFormula.trim(),
      confidence: 1,
      matched_columns: {},
      source: "interview",
      domain: "custom",
    };
    setSelected((p) => [...p, kpi]);
    setCustomName("");
    setCustomFormula("");
  };

  const onDragStart = (i: number) => { dragItem.current = i; };
  const onDragEnter = (i: number) => { dragOver.current = i; };
  const onDrop = () => {
    if (dragItem.current === null || dragOver.current === null) return;
    const reordered = [...selected];
    const [moved] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOver.current, 0, moved);
    setSelected(reordered);
    dragItem.current = null;
    dragOver.current = null;
  };

  async function handleGenerate() {
    if (selected.length === 0) return;
    setGenerating(true);
    try {
      const confirmedRel = (() => {
        const raw = sessionStorage.getItem(`dataset_${datasetId}_relationships`);
        return raw ? JSON.parse(raw) : [];
      })();
      const res = await api.generateDashboard(
        Number(datasetId),
        selected.map((k) => k.kpi_id),
        confirmedRel,
      );
      router.push(`/dashboard/${res.recipe_id}`);
    } catch (e) {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-lg font-bold text-[#1B2340]">KPI Selection</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Check the KPIs you want in your dashboard. Drag to reorder the selected list.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-sm text-gray-400">
          <span className="animate-spin h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full mr-3" />
          Finding matching KPIs…
        </div>
      ) : (
        <div className="flex-1 flex gap-0 overflow-hidden">

          {/* Left panel — available KPIs */}
          <div className="flex-1 flex flex-col border-r border-gray-100 overflow-hidden">
            {/* Filters */}
            <div className="px-5 py-3 border-b border-gray-100 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {domains.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDomainFilter(d)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors
                      ${domainFilter === d ? "bg-[#1B2340] text-white border-[#1B2340]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search KPIs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1B2340]"
                />
                <button onClick={selectAll} className="text-xs text-blue-500 hover:underline whitespace-nowrap">Select all</button>
                <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline whitespace-nowrap">Deselect all</button>
              </div>
            </div>

            {/* KPI list */}
            <div className="flex-1 overflow-y-auto">
              {available.length === 0 ? (
                <p className="p-5 text-sm text-gray-400">No KPIs match the current filter.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {available.map((kpi) => (
                    <li
                      key={kpi.kpi_id}
                      onDoubleClick={() => setCommentOpen(commentOpen === kpi.kpi_id ? null : kpi.kpi_id)}
                      className="px-5 py-3 hover:bg-gray-50 cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => addKpi(kpi)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 h-4 w-4 rounded accent-teal-600 flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{kpi.display_name}</p>
                            <p className="text-xs text-gray-400 font-mono truncate">{kpi.formula}</p>
                            {commentOpen === kpi.kpi_id && (
                              <input
                                type="text"
                                placeholder="Add comment…"
                                value={comment[kpi.kpi_id] ?? ""}
                                onChange={(e) => setComment({ ...comment, [kpi.kpi_id]: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1.5 text-xs border border-gray-200 rounded px-2 py-1 w-full focus:outline-none"
                                autoFocus
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-xs font-semibold ${CONF_COLOR(kpi.confidence)}`}>
                            {Math.round(kpi.confidence * 100)}%
                          </span>
                          {kpi.domain && (
                            <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${DOMAIN_COLORS[kpi.domain] ?? DOMAIN_COLORS.ops}`}>
                              {kpi.domain}
                            </span>
                          )}
                          {kpi.source === "interview" && (
                            <span className="text-xs bg-pink-50 text-pink-600 border border-pink-100 px-2 py-0.5 rounded-full">custom</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right panel — selected KPIs */}
          <div className="w-80 flex flex-col bg-gray-50 border-l border-gray-100">
            <div className="px-4 py-3 border-b border-gray-100 bg-white flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Selected ({selected.length})</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selected.length === 0 ? (
                <p className="p-4 text-xs text-gray-400">Click KPIs on the left to add them here.</p>
              ) : (
                <ul className="divide-y divide-gray-100" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
                  {selected.map((kpi, i) => (
                    <li
                      key={kpi.kpi_id}
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragEnter={() => onDragEnter(i)}
                      className="flex items-start gap-2 px-4 py-3 bg-white hover:bg-gray-50 cursor-grab active:cursor-grabbing"
                    >
                      <span className="text-gray-300 mt-0.5 flex-shrink-0">⠿</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{kpi.display_name}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">{kpi.formula}</p>
                        {comment[kpi.kpi_id] && (
                          <p className="text-xs text-gray-400 italic mt-0.5">{comment[kpi.kpi_id]}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeKpi(kpi.kpi_id)}
                        className="text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0 mt-0.5"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add custom KPI */}
            <div className="border-t border-gray-100 p-4 space-y-2 bg-white">
              <p className="text-xs font-semibold text-gray-500">Add custom KPI</p>
              <input
                type="text"
                placeholder="KPI name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Formula, e.g. revenue / contacts"
                value={customFormula}
                onChange={(e) => setCustomFormula(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none font-mono"
              />
              <button
                onClick={addCustom}
                disabled={!customName.trim()}
                className="w-full py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                + Add
              </button>
            </div>

            {/* Generate button */}
            <div className="border-t border-gray-100 p-4 bg-white">
              <button
                onClick={handleGenerate}
                disabled={selected.length === 0 || generating}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#1B2340] text-white hover:bg-[#243060] disabled:opacity-40 transition-colors"
              >
                {generating ? "Generating…" : `Generate Dashboard (${selected.length} KPIs)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
