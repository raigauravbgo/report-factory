"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import FormulaInput from "@/components/FormulaInput";
import ValidationPanel from "@/components/ValidationPanel";
import { api } from "@/lib/api";
import type { ChartType, KpiSpec, NullHandling, RecipeConfig, ValidationResult } from "@/lib/types";

const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: "line", label: "Line", icon: "📈" },
  { value: "bar", label: "Bar", icon: "📊" },
  { value: "table", label: "Table", icon: "📋" },
  { value: "kpi_card", label: "KPI Card", icon: "🔢" },
];

const NULL_HANDLING_OPTIONS: { value: NullHandling; label: string }[] = [
  { value: "exclude_nulls", label: "Exclude nulls" },
  { value: "treat_as_zero", label: "Treat as zero" },
  { value: "carry_forward", label: "Carry forward" },
];

function extractColsFromFormula(formula: string): string[] {
  const f = formula.trim();
  const aggMatch = f.match(/^(?:mean|avg|average|sum|count|median|max|min)\(([^)]+)\)$/i);
  if (aggMatch) return [aggMatch[1].trim()];
  if (f.includes("/")) {
    return f.split("/").flatMap((p) => {
      const m = p.trim().match(/^(?:mean|avg|sum|count|median|max|min)\(([^)]+)\)$/i);
      return [m ? m[1].trim() : p.trim()];
    });
  }
  if (!/[+\-*()]/.test(f)) return [f];
  return [];
}

export default function RecipePage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [config, setConfig] = useState<RecipeConfig | null>(null);
  const [availableCols, setAvailableCols] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [formulaErrors, setFormulaErrors] = useState<Record<number, boolean>>({});
  const [kpiWarnings, setKpiWarnings] = useState<{ kpiName: string; column: string; sourceFile: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRecipe(Number(recipeId))
      .then(async (r) => {
        setConfig(r.config);
        setApproved(!!r.approved_at);
        // Load column names for formula validation
        try {
          const schema = await api.getDatasetSchema(r.config.dataset_id);
          const cols = schema.uploads.flatMap((u) => u.columns.map((c) => c.column_name));
          setAvailableCols(cols);

          // Warn if a KPI formula references a column that only exists in a secondary upload
          const primaryUpload = schema.uploads.find((u) => u.upload_id === r.config.upload_id);
          const primaryColSet = new Set(primaryUpload?.columns.map((c) => c.column_name) ?? []);
          const warnings: { kpiName: string; column: string; sourceFile: string }[] = [];
          for (const kpi of r.config.kpis) {
            for (const col of extractColsFromFormula(kpi.formula)) {
              if (!primaryColSet.has(col) && cols.includes(col)) {
                const src = schema.uploads.find((u) => u.columns.some((c) => c.column_name === col));
                warnings.push({ kpiName: kpi.name, column: col, sourceFile: src?.filename ?? "another file" });
              }
            }
          }
          setKpiWarnings(warnings);
        } catch {
          // Non-fatal: formula validation will still work client-side with empty list
        }
      })
      .catch((e) => setError(String(e)));
  }, [recipeId]);

  function updateKpi(index: number, field: keyof KpiSpec, value: string) {
    if (!config) return;
    const kpis = config.kpis.map((k, i) => (i === index ? { ...k, [field]: value } : k));
    setConfig({ ...config, kpis });
  }

  function updateMapping(raw: string, display: string) {
    if (!config) return;
    setConfig({ ...config, column_mappings: { ...config.column_mappings, [raw]: display } });
  }

  function updateChartType(index: number, type: ChartType) {
    if (!config) return;
    const chart_layout = config.chart_layout.map((c, i) =>
      i === index ? { ...c, type } : c
    );
    setConfig({ ...config, chart_layout });
  }

  function updateNullHandling(index: number, null_handling: NullHandling) {
    if (!config) return;
    const chart_layout = config.chart_layout.map((c, i) =>
      i === index ? { ...c, null_handling } : c
    );
    setConfig({ ...config, chart_layout });
  }

  function moveChart(index: number, dir: -1 | 1) {
    if (!config) return;
    const layout = [...config.chart_layout];
    const target = index + dir;
    if (target < 0 || target >= layout.length) return;
    [layout[index], layout[target]] = [layout[target], layout[index]];
    setConfig({ ...config, chart_layout: layout });
  }

  function hasFormulaErrors() {
    return Object.values(formulaErrors).some(Boolean);
  }

  async function handleValidate() {
    if (!config) return;
    setValidating(true);
    try {
      const result = await api.validateRecipe(config, availableCols);
      setValidation(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setValidating(false);
    }
  }

  async function handleApprove() {
    if (!config) return;
    if (hasFormulaErrors()) {
      setError("Fix formula errors before approving.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.approveRecipe(Number(recipeId), config);
      // Redirect back to dashboard after saving
      router.push(`/dashboard/${recipeId}`);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  if (error && !config) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 flex items-center gap-3 text-gray-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Loading recipe…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Report recipe</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and edit the configuration before approving.
            {config.interview_skipped && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                AI-generated (interview skipped)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {approved && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Approved
            </span>
          )}
        </div>
      </div>

      {validation && <ValidationPanel validation={validation} className="mb-0" />}

      {/* Summary */}
      <section className="rounded-lg border border-gray-200 p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Configuration</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">Date column</dt>
          <dd className="font-mono text-gray-900">{config.date_column}</dd>
          <dt className="text-gray-500">Granularity</dt>
          <dd className="text-gray-900 capitalize">{config.granularity}</dd>
          <dt className="text-gray-500">Dimensions</dt>
          <dd className="text-gray-900">{config.dimensions.join(", ") || "—"}</dd>
          <dt className="text-gray-500">Filters</dt>
          <dd className="text-gray-900">{config.filters.join(", ") || "None"}</dd>
        </dl>
      </section>

      {/* KPI definitions with live formula validation */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">KPI definitions</h2>

        {kpiWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
            <p className="text-sm font-medium text-amber-800">Column mismatch — these KPIs will not appear on the dashboard</p>
            {kpiWarnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">
                <span className="font-semibold">{w.kpiName}</span>: column{" "}
                <code className="rounded bg-amber-100 px-1">{w.column}</code> is in{" "}
                <span className="font-medium">{w.sourceFile}</span>, not in the primary fact table.
                Update the formula to use a column from the main file.
              </p>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {config.kpis.map((kpi, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-3 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Name</label>
                <input
                  value={kpi.name}
                  onChange={(e) => updateKpi(i, "name", e.target.value)}
                  disabled={approved}
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Formula</label>
                {approved ? (
                  <p className="font-mono text-sm text-gray-700 px-2 py-1.5">{kpi.formula}</p>
                ) : (
                  <FormulaInput
                    value={kpi.formula}
                    onChange={(v) => updateKpi(i, "formula", v)}
                    availableColumns={availableCols}
                    onValidation={(result) =>
                      setFormulaErrors((prev) => ({ ...prev, [i]: !result.valid }))
                    }
                    disabled={approved}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Chart layout */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Dashboard layout</h2>
        <div className="space-y-2">
          {config.chart_layout.map((chart, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveChart(i, -1)}
                  disabled={i === 0 || approved}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveChart(i, 1)}
                  disabled={i === config.chart_layout.length - 1 || approved}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none"
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              <span className="w-6 text-center text-sm text-gray-400">{i + 1}</span>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-800 truncate">{chart.title}</p>
                <p className="text-xs text-gray-400 truncate">KPI: {chart.kpi}{chart.group_by ? ` · by ${chart.group_by}` : ""}</p>
              </div>

              <div className="flex items-center gap-2">
                {/* Chart type selector */}
                <select
                  value={chart.type}
                  onChange={(e) => updateChartType(i, e.target.value as ChartType)}
                  disabled={approved}
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-xs disabled:bg-gray-50"
                >
                  {CHART_TYPES.map((ct) => (
                    <option key={ct.value} value={ct.value}>
                      {ct.icon} {ct.label}
                    </option>
                  ))}
                </select>

                {/* Null handling */}
                <select
                  value={chart.null_handling ?? "exclude_nulls"}
                  onChange={(e) => updateNullHandling(i, e.target.value as NullHandling)}
                  disabled={approved}
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-xs disabled:bg-gray-50"
                >
                  {NULL_HANDLING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Column display names — only columns actually used in this recipe */}
      {(() => {
        const identifierRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        const AGG_FUNCS = new Set(["mean","avg","average","sum","count","median","max","min"]);
        const relevant = new Set<string>();
        if (config.date_column) relevant.add(config.date_column);
        config.dimensions.forEach((d) => relevant.add(d));
        config.filters.forEach((f) => relevant.add(f));
        config.kpis.forEach((kpi) => {
          for (const m of kpi.formula.matchAll(identifierRe)) {
            if (!AGG_FUNCS.has(m[1].toLowerCase())) relevant.add(m[1]);
          }
        });
        const entries = Object.entries(config.column_mappings).filter(([raw]) => relevant.has(raw));
        if (entries.length === 0) return null;
        return (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Column display names
            </h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-1/2">Raw name</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Display name</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([raw, display]) => (
                    <tr key={raw} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2 font-mono text-gray-500">{raw}</td>
                      <td className="px-4 py-2">
                        <input
                          value={display}
                          onChange={(e) => updateMapping(raw, e.target.value)}
                          disabled={approved}
                          className="w-full rounded border border-transparent px-1 py-0.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-transparent"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex justify-between gap-3 pt-2">
        <button
          onClick={() => router.push(`/dashboard/${recipeId}`)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ← Back to dashboard
        </button>
        <div className="flex gap-3">
          {!approved && (
            <button
              onClick={handleValidate}
              disabled={validating}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {validating ? "Validating…" : "Validate"}
            </button>
          )}
          <button
            onClick={approved ? () => router.push(`/dashboard/${recipeId}`) : handleApprove}
            disabled={!approved && (loading || hasFormulaErrors())}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={!approved && hasFormulaErrors() ? "Fix formula errors first" : undefined}
          >
            {approved ? "View dashboard →" : loading ? "Saving…" : "Save & back to dashboard"}
          </button>
        </div>
      </div>
    </main>
  );
}
