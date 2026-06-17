"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface KpiEntry { name: string; formula: string; aggregation: string; format: string }
interface Template {
  id: number;
  name: string;
  kpi_names: string[];
  kpi_count: number;
  date_column: string;
  granularity: string;
  dimensions: string[];
  filters: string[];
  config: Record<string, unknown>;
  source_recipe_id: number | null;
}

type OverrideScope = "permanent" | "session";

interface PendingOverride {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export default function ReviewPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();

  const [template, setTemplate] = useState<Template | null>(null);
  const [kpis, setKpis] = useState<KpiEntry[]>([]);
  const [dateColumn, setDateColumn] = useState("");
  const [granularity, setGranularity] = useState("weekly");
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [filters, setFilters] = useState<string[]>([]);

  // Override confirmation state
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [editingKpiIdx, setEditingKpiIdx] = useState<number | null>(null);
  const [editingKpiFormula, setEditingKpiFormula] = useState("");

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(`dataset_${datasetId}_template`);
    if (!raw) { router.push(`/session/${datasetId}/schema`); return; }
    const t: Template = JSON.parse(raw);
    setTemplate(t);
    const cfg = t.config as Record<string, unknown>;
    setKpis((cfg.kpis as KpiEntry[]) ?? []);
    setDateColumn((cfg.date_column as string) ?? "");
    setGranularity((cfg.granularity as string) ?? "weekly");
    setDimensions((cfg.dimensions as string[]) ?? []);
    setFilters((cfg.filters as string[]) ?? []);
  }, [datasetId]);

  function requestOverride(field: string, oldValue: unknown, newValue: unknown) {
    setPendingOverride({ field, oldValue, newValue });
  }

  function applyOverride(scope: OverrideScope) {
    if (!pendingOverride || !template) return;
    const { field, newValue } = pendingOverride;

    if (field.startsWith("kpi_formula_")) {
      const idx = parseInt(field.split("_").pop()!);
      const updated = kpis.map((k, i) => i === idx ? { ...k, formula: newValue as string } : k);
      setKpis(updated);
      if (scope === "permanent") {
        persistTemplateUpdate(template.id, { kpis: updated });
      }
    } else if (field === "date_column") {
      setDateColumn(newValue as string);
      if (scope === "permanent") persistTemplateUpdate(template.id, { date_column: newValue });
    } else if (field === "granularity") {
      setGranularity(newValue as string);
      if (scope === "permanent") persistTemplateUpdate(template.id, { granularity: newValue });
    }
    setPendingOverride(null);
    setEditingKpiIdx(null);
  }

  async function persistTemplateUpdate(templateId: number, patch: Record<string, unknown>) {
    try {
      const t = template!;
      const updatedConfig = { ...t.config, ...patch };
      await fetch(`${BASE_URL}/api/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: updatedConfig }),
      });
    } catch { /* non-blocking — template update is best-effort */ }
  }

  async function handlePublish() {
    if (!datasetId || !template) return;
    setPublishing(true);
    setPublishError(null);

    // Retrieve interview + relationship context stored by earlier steps (may be empty for template path)
    let interviewResult: Record<string, unknown> = {};
    try {
      const raw = sessionStorage.getItem(`dataset_${datasetId}_interview`);
      if (raw) interviewResult = JSON.parse(raw);
    } catch { /* ignore */ }

    // Build selected_kpis in the format session_generator expects
    const selectedKpis = kpis.map((k) => ({
      kpi_id: k.name.toLowerCase().replace(/\s+/g, "_"),
      display_name: k.name,
      formula: k.formula,
      aggregation: k.aggregation || "sum",
      format: k.format || "decimal",
      source: "catalog",  // template KPIs treated as catalog so they don't re-queue as proposals
    }));

    // Merge overrides into interview_result
    const mergedInterview = {
      ...interviewResult,
      date_column: dateColumn,
      granularity,
      dimensions,
      filters,
    };

    try {
      const res = await fetch(`${BASE_URL}/session/${datasetId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_kpis: selectedKpis,
          confirmed_relationships: [],
          interview_result: mergedInterview,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || `API ${res.status}`);
      }
      const { recipe_id } = await res.json();
      sessionStorage.removeItem(`dataset_${datasetId}_template`);
      router.push(`/dashboard/${recipe_id}`);
    } catch (e: unknown) {
      setPublishError(e instanceof Error ? e.message : "Failed to publish dashboard");
    } finally {
      setPublishing(false);
    }
  }

  if (!template) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[#94A3B8]">
        Loading template…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F1629] text-white">
      {/* Header */}
      <div className="bg-[#1B2340] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] bg-[#00B5AD]/10 text-[#00B5AD] border border-[#00B5AD]/20 px-2 py-0.5 rounded font-semibold">
              Template
            </span>
            <h1 className="text-[15px] font-bold text-white">{template.name}</h1>
          </div>
          <p className="text-[11px] text-[#94A3B8]">
            Review prefilled configuration — edit anything, then publish straight to your dashboard.
          </p>
        </div>
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="bg-[#00B5AD] hover:bg-[#00B5AD]/90 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-[13px] font-semibold transition-colors flex items-center gap-2"
        >
          {publishing
            ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> Publishing…</>
            : "Publish Dashboard →"}
        </button>
      </div>

      {publishError && (
        <div className="mx-6 mt-4 bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 text-[12px] text-red-400">
          {publishError}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Date & Granularity */}
        <Section title="Time Settings">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date Column">
              <input
                type="text"
                value={dateColumn}
                onChange={(e) => requestOverride("date_column", dateColumn, e.target.value)}
                className="w-full bg-[#0F1629] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#00B5AD]/50"
              />
            </Field>
            <Field label="Granularity">
              <select
                value={granularity}
                onChange={(e) => requestOverride("granularity", granularity, e.target.value)}
                className="w-full bg-[#0F1629] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#00B5AD]/50"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* KPIs */}
        <Section title={`KPIs (${kpis.length})`}>
          <div className="space-y-2">
            {kpis.map((kpi, idx) => (
              <div key={idx} className="bg-[#0F1629] rounded-lg px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white">{kpi.name}</p>
                  {editingKpiIdx === idx ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingKpiFormula}
                      onChange={(e) => setEditingKpiFormula(e.target.value)}
                      onBlur={() => {
                        if (editingKpiFormula !== kpi.formula) {
                          requestOverride(`kpi_formula_${idx}`, kpi.formula, editingKpiFormula);
                        } else {
                          setEditingKpiIdx(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (editingKpiFormula !== kpi.formula) {
                            requestOverride(`kpi_formula_${idx}`, kpi.formula, editingKpiFormula);
                          } else {
                            setEditingKpiIdx(null);
                          }
                        }
                        if (e.key === "Escape") setEditingKpiIdx(null);
                      }}
                      className="mt-1 w-full bg-[#1B2340] border border-[#00B5AD]/30 rounded px-2 py-1 text-[11px] text-[#00B5AD] font-mono focus:outline-none"
                    />
                  ) : (
                    <p
                      className="text-[11px] text-[#00B5AD] font-mono mt-0.5 cursor-pointer hover:underline"
                      onClick={() => { setEditingKpiIdx(idx); setEditingKpiFormula(kpi.formula); }}
                      title="Click to edit formula"
                    >
                      {kpi.formula}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 text-[10px] flex-shrink-0">
                  <span className="text-[#64748B] capitalize">{kpi.format}</span>
                  <span className="text-[#64748B]">·</span>
                  <span className="text-[#64748B] capitalize">{kpi.aggregation}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Dimensions & Filters */}
        <Section title="Dimensions & Filters">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Dimensions">
              <p className="text-[12px] text-[#94A3B8]">
                {dimensions.length > 0 ? dimensions.join(", ") : <span className="text-[#64748B] italic">None configured</span>}
              </p>
            </Field>
            <Field label="Filters">
              <p className="text-[12px] text-[#94A3B8]">
                {filters.length > 0 ? filters.join(", ") : <span className="text-[#64748B] italic">None configured</span>}
              </p>
            </Field>
          </div>
        </Section>

      </div>

      {/* Override confirmation modal */}
      {pendingOverride && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B2340] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-[15px] mb-2">Apply this change?</h2>
            <p className="text-[#94A3B8] text-[12px] mb-1">
              <span className="line-through text-[#64748B]">{String(pendingOverride.oldValue)}</span>
              {" → "}
              <span className="text-white font-mono">{String(pendingOverride.newValue)}</span>
            </p>
            <p className="text-[#64748B] text-[11px] mb-5">
              Save permanently to update the template, or apply to this dashboard run only.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => applyOverride("permanent")}
                className="w-full bg-[#00B5AD] hover:bg-[#00B5AD]/90 text-white py-2.5 rounded-lg text-[12px] font-semibold transition-colors"
              >
                Update template permanently
              </button>
              <button
                onClick={() => applyOverride("session")}
                className="w-full bg-white/5 hover:bg-white/10 text-white py-2.5 rounded-lg text-[12px] font-medium transition-colors"
              >
                Use for this run only
              </button>
              <button
                onClick={() => { setPendingOverride(null); setEditingKpiIdx(null); }}
                className="w-full text-[#64748B] hover:text-white py-2 text-[11px] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1B2340] border border-white/10 rounded-xl p-5">
      <h3 className="text-[12px] font-bold text-[#94A3B8] uppercase tracking-[0.08em] mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-[0.06em]">{label}</label>
      {children}
    </div>
  );
}
