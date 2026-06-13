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
  const [dimensionCols, setDimensionCols] = useState<string[]>([]);
  const [uploadFilenames, setUploadFilenames] = useState<Record<number, string>>({});
  const [isMultiFile, setIsMultiFile] = useState(false);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [formulaErrors, setFormulaErrors] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRecipe(Number(recipeId))
      .then(async (r) => {
        setConfig(r.config);
        setApproved(!!r.approved_at);
        try {
          const schema = await api.getDatasetSchema(r.config.dataset_id);
          const cols = [...new Set(schema.uploads.flatMap((u) => u.columns.map((c) => c.column_name)))];
          setAvailableCols(cols);
          const fnMap: Record<number, string> = {};
          for (const u of schema.uploads) fnMap[u.upload_id] = u.filename;
          setUploadFilenames(fnMap);
          setIsMultiFile(schema.uploads.length > 1);
        } catch {
          // Non-fatal
        }
        try {
          const dimResult = await api.getDimensionSuggestions(r.config.dataset_id);
          setDimensionCols([...new Set(dimResult.suggestions.map((s) => s.column_name))]);
        } catch {
          // Fall back to currently selected dimensions so the checkboxes still work
          setDimensionCols(r.config.dimensions);
        }
      })
      .catch((e) => setError(String(e)));
  }, [recipeId]);

  function updateKpi(index: number, field: keyof KpiSpec, value: string) {
    if (!config) return;
    const kpis = config.kpis.map((k, i) => {
      if (i !== index) return k;
      // Clear resolved_formula whenever the user edits formula so the dashboard
      // evaluates the user's formula instead of the stale auto-resolved one.
      const updated: KpiSpec = { ...k, [field]: value };
      if (field === "formula") updated.resolved_formula = null;
      return updated;
    });
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

  function updateShowBreakdown(index: number, show_breakdown: boolean) {
    if (!config) return;
    const chart_layout = config.chart_layout.map((c, i) =>
      i === index ? { ...c, show_breakdown } : c
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
            <>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                Approved
              </span>
              <button
                onClick={() => setApproved(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Edit recipe
              </button>
            </>
          )}
        </div>
      </div>

      {validation && <ValidationPanel validation={validation} className="mb-0" />}

      {/* Configuration — editable when not approved */}
      <section className="rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Configuration</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">

          {/* Date column */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date column</label>
            {approved ? (
              <p className="font-mono text-gray-900">{config.date_column}</p>
            ) : (
              <select
                value={config.date_column}
                onChange={(e) => setConfig({ ...config, date_column: e.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
              >
                {availableCols.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            )}
          </div>

          {/* Granularity */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Granularity</label>
            {approved ? (
              <p className="text-gray-900 capitalize">{config.granularity}</p>
            ) : (
              <select
                value={config.granularity}
                onChange={(e) => setConfig({ ...config, granularity: e.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
              >
                {["daily", "weekly", "monthly", "yearly"].map((g) => (
                  <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                ))}
              </select>
            )}
          </div>

          {/* Dimensions */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dimensions</label>
            {approved ? (
              <p className="text-gray-900">{config.dimensions.join(", ") || "—"}</p>
            ) : (
              <div className="rounded border border-gray-200 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                {dimensionCols.map((col) => (
                  <label key={col} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.dimensions.includes(col)}
                      onChange={(e) => {
                        const dims = e.target.checked
                          ? [...config.dimensions, col]
                          : config.dimensions.filter((d) => d !== col);
                        setConfig({ ...config, dimensions: dims });
                      }}
                      className="accent-blue-600"
                    />
                    <span className="text-sm font-mono text-gray-700">{col}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Filters */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Filters</label>
            {approved ? (
              <p className="text-gray-900">{config.filters.join(", ") || "None"}</p>
            ) : (
              <div className="rounded border border-gray-200 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                {dimensionCols.map((col) => (
                  <label key={col} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.filters.includes(col)}
                      onChange={(e) => {
                        const filters = e.target.checked
                          ? [...config.filters, col]
                          : config.filters.filter((f) => f !== col);
                        setConfig({ ...config, filters });
                      }}
                      className="accent-blue-600"
                    />
                    <span className="text-sm font-mono text-gray-700">{col}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

        </div>
      </section>

      {/* KPI definitions with live formula validation */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">KPI definitions</h2>

        <div className="space-y-2">
          {config.kpis.map((kpi, i) => {
            const sourceFileName = isMultiFile && kpi.upload_id != null
              ? uploadFilenames[kpi.upload_id]
              : undefined;
            return (
              <div key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-3 grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <label className="text-xs text-gray-500">Name</label>
                    {sourceFileName && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200" title={`Source: ${sourceFileName}`}>
                        {sourceFileName.length > 22 ? sourceFileName.slice(0, 22) + "…" : sourceFileName}
                      </span>
                    )}
                  </div>
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
            );
          })}
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

                {/* Driver Analysis toggle — only relevant for bar charts */}
                {chart.type === "bar" && (
                  <label className={`flex items-center gap-1.5 cursor-pointer rounded border px-2 py-1 text-xs transition-colors
                    ${approved ? "pointer-events-none opacity-60" : ""}
                    ${(chart.show_breakdown ?? true)
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-400"}`}
                    title="Include this KPI in the Driver Analysis section of the dashboard"
                  >
                    <input
                      type="checkbox"
                      checked={chart.show_breakdown ?? true}
                      onChange={(e) => updateShowBreakdown(i, e.target.checked)}
                      disabled={approved}
                      className="accent-blue-600"
                    />
                    Driver chart
                  </label>
                )}
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
