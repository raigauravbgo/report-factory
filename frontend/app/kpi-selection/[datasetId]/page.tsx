"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import KpiCard from "@/components/KpiCard";
import FormulaInput from "@/components/FormulaInput";
import ValidationPanel from "@/components/ValidationPanel";
import { api } from "@/lib/api";
import type { KpiSpec, KpiSuggestion, ValidationResult } from "@/lib/types";

interface PageProps {
  params: Promise<{ datasetId: string }>;
}

export default function KpiSelectionPage({ params }: PageProps) {
  const { datasetId } = use(params);
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<KpiSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customKpis, setCustomKpis] = useState<KpiSpec[]>([]);
  // which custom KPI rows are selected (index-based); new rows default to selected
  const [customSelected, setCustomSelected] = useState<Set<number>>(new Set());
  const [availableCols, setAvailableCols] = useState<string[]>([]);
  // kpi_id → upload_id of source fact table (auto-populated from suggestions, user can override)
  const [kpiSourceMap, setKpiSourceMap] = useState<Record<string, number>>({});
  // upload_id → filename for badge display
  const [uploadFilenames, setUploadFilenames] = useState<Record<number, string>>({});
  const [multiFile, setMultiFile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getKpiSuggestions(Number(datasetId)),
      api.getDatasetSchema(Number(datasetId)),
    ])
      .then(([kpiRes, schemaRes]) => {
        setSuggestions(kpiRes.suggestions);
        // Pre-select KPIs with score > 0.7
        setSelected(
          new Set(kpiRes.suggestions.filter((k) => k.relevance_score >= 0.7).map((k) => k.kpi_id))
        );
        // Build kpi_id → upload_id from suggestion metadata
        const srcMap: Record<string, number> = {};
        for (const s of kpiRes.suggestions) {
          if (s.upload_id != null) srcMap[s.kpi_id] = s.upload_id;
        }
        setKpiSourceMap(srcMap);
        // Build upload_id → filename for badge labels
        const fnMap: Record<number, string> = {};
        for (const u of schemaRes.uploads) fnMap[u.upload_id] = u.filename;
        setUploadFilenames(fnMap);
        setMultiFile(schemaRes.uploads.length > 1);
        // Collect available columns for formula validation
        const cols = schemaRes.uploads.flatMap((u) => u.columns.map((c) => c.column_name));
        setAvailableCols(cols);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [datasetId]);

  function toggleKpi(kpiId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kpiId)) next.delete(kpiId);
      else next.add(kpiId);
      return next;
    });
  }

  function addCustomKpi() {
    setCustomKpis((prev) => {
      const next = [...prev, { name: "", formula: "" }];
      // auto-select the new row
      setCustomSelected((s) => new Set([...s, next.length - 1]));
      return next;
    });
  }

  function updateCustomKpi(i: number, field: "name" | "formula", value: string) {
    setCustomKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, [field]: value } : k)));
  }

  function toggleCustomKpi(i: number) {
    setCustomSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function removeCustomKpi(i: number) {
    setCustomKpis((prev) => prev.filter((_, idx) => idx !== i));
    setCustomSelected((prev) => {
      // rebuild indices: shift down all indices > i
      const next = new Set<number>();
      prev.forEach((idx) => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1); });
      return next;
    });
  }

  // custom KPIs that are both selected and have valid name+formula
  const validSelectedCustom = customKpis.filter(
    (k, i) => customSelected.has(i) && k.name.trim() && k.formula.trim()
  );
  const canContinue = selected.size > 0 || validSelectedCustom.length > 0;

  async function handleContinue() {
    setSaving(true);
    setValidation(null);
    try {
      const res = await api.selectKpis(Number(datasetId), [...selected], validSelectedCustom, kpiSourceMap);
      router.push(`/dimension-selection/${datasetId}`);
    } catch (e: unknown) {
      // 422 with validation errors
      if (e instanceof Error && e.message.includes("422")) {
        try {
          const body = JSON.parse(e.message.replace(/^API \d+: /, ""));
          if (body.errors) {
            setValidation({ valid: false, errors: body.errors });
          }
        } catch {
          setError(String(e));
        }
      } else {
        setError(String(e));
      }
      setSaving(false);
    }
  }

  if (loading) return <CentreSpinner label="Loading KPI suggestions…" />;
  if (error) return <ErrorBox message={error} />;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">KPI Selection</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI has ranked KPIs by relevance to your data. Select the ones you want on the dashboard.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {selected.size + validSelectedCustom.length} selected
          </span>
          <button
            onClick={handleContinue}
            disabled={saving || !canContinue}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue →"}
          </button>
        </div>
      </div>

      {validation && <ValidationPanel validation={validation} className="mb-6" />}

      {/* Catalog KPIs */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">Suggested KPIs</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set(suggestions.map((k) => k.kpi_id)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Select all
            </button>
            <span className="text-xs text-gray-300">|</span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-gray-500 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((kpi) => (
            <KpiCard
              key={kpi.kpi_id}
              kpi={kpi}
              selected={selected.has(kpi.kpi_id)}
              onToggle={toggleKpi}
              sourceFile={multiFile && kpi.upload_id != null ? uploadFilenames[kpi.upload_id] : undefined}
            />
          ))}
        </div>
      </section>

      {/* Custom KPIs */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">Custom KPIs</h2>
          <button
            onClick={addCustomKpi}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            + Add custom KPI
          </button>
        </div>
        {customKpis.length === 0 ? (
          <p className="text-sm text-gray-400">No custom KPIs added yet.</p>
        ) : (
          <div className="space-y-3">
            {customKpis.map((kpi, i) => {
              const isSelected = customSelected.has(i);
              const isValid = kpi.name.trim() && kpi.formula.trim();
              return (
                <div
                  key={i}
                  className={[
                    "flex gap-3 rounded-lg border px-4 py-3 transition-colors",
                    isSelected && isValid
                      ? "border-blue-300 bg-blue-50"
                      : "border-gray-200 bg-white",
                  ].join(" ")}
                >
                  {/* Selection checkbox */}
                  <div className="flex items-start pt-6">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCustomKpi(i)}
                      disabled={!isValid}
                      title={isValid ? "Include this KPI" : "Fill in name and formula first"}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-30 cursor-pointer"
                    />
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                      <input
                        type="text"
                        value={kpi.name}
                        onChange={(e) => updateCustomKpi(i, "name", e.target.value)}
                        placeholder="e.g. Conversion Rate"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Formula</label>
                      <FormulaInput
                        value={kpi.formula}
                        onChange={(v) => updateCustomKpi(i, "formula", v)}
                        availableColumns={availableCols}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeCustomKpi(i)}
                    className="mt-6 text-gray-300 hover:text-red-400"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function CentreSpinner({ label }: { label: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="mt-4 text-sm text-gray-500">{label}</p>
      </div>
    </main>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
    </main>
  );
}
