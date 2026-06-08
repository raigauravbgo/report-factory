"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import { formatKpiValue } from "@/lib/format";
import type { RecipeConfig } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

const GRANULARITIES = ["daily", "weekly", "monthly"] as const;

type ValidationStatus = "idle" | "checking" | "valid" | "invalid";

interface Validation {
  status: ValidationStatus;
  preview?: number | null;
  error?: string | null;
}

let _idSeq = 0;
const uid = () => ++_idSeq;

interface KpiRow {
  id: number;
  name: string;
  formula: string;
  aggregation: string;
  format: string;
}

interface MappingRow {
  id: number;
  raw: string;
  display: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function configToKpiRows(kpis: RecipeConfig["kpis"]): KpiRow[] {
  return kpis.map((k) => ({
    id: uid(),
    name: k.name,
    formula: k.formula,
    aggregation: k.aggregation ?? "",
    format: k.format ?? "",
  }));
}

function configToMappingRows(record: Record<string, string>): MappingRow[] {
  return Object.entries(record).map(([raw, display]) => ({ id: uid(), raw, display }));
}

function mappingRowsToRecord(rows: MappingRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.raw.trim()) out[r.raw.trim()] = r.display;
  }
  return out;
}

// ── Validation badge ───────────────────────────────────────────────────────

function ValidationBadge({ v, formula }: { v: Validation | undefined; formula: string }) {
  if (!formula.trim()) return null;
  if (!v || v.status === "idle")
    return <span title="Not yet validated" className="text-gray-300 text-xs">●</span>;
  if (v.status === "checking")
    return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />;
  if (v.status === "valid")
    return (
      <span className="flex items-center gap-1 text-green-600 text-xs font-medium whitespace-nowrap">
        ✓
        {v.preview !== null && v.preview !== undefined && (
          <span className="text-green-500 font-mono">{formatKpiValue(v.preview, formula)}</span>
        )}
      </span>
    );
  return (
    <span title={v.error ?? "Invalid formula"} className="text-red-500 text-xs font-medium">✕</span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RecipePage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [baseConfig, setBaseConfig] = useState<RecipeConfig | null>(null);
  const [approved, setApproved] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);

  // Editable slices
  const [dateCol, setDateCol] = useState("");
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [filters, setFilters] = useState<string[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);

  // Filter auto-sync
  const [unsyncedFilters, setUnsyncedFilters] = useState<string[]>([]);

  // Per-formula validation (formula input → backend test-compute)
  const [validations, setValidations] = useState<Record<number, Validation>>({});
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Data integrity check (recipe config vs actual staging data)
  type ConfigValidation = {
    valid: boolean;
    errors: string[];
    warnings: string[];
    details: {
      date_span_days?: number | null;
      missing_filter_columns?: string[];
      high_cardinality_filters?: string[];
      failing_kpi_formulas?: string[];
    };
  };
  const [configValidation, setConfigValidation] = useState<ConfigValidation | null>(null);
  const [configValidating, setConfigValidating] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New KPI / mapping input state
  const [newKpiName, setNewKpiName] = useState("");
  const [newKpiFormula, setNewKpiFormula] = useState("");
  const [newMapRaw, setNewMapRaw] = useState("");
  const [newMapDisplay, setNewMapDisplay] = useState("");
  const [addingKpi, setAddingKpi] = useState(false);
  const [addingMap, setAddingMap] = useState(false);

  // ── Load recipe ──────────────────────────────────────────────────────────
  useEffect(() => {
    api
      .getRecipe(Number(recipeId))
      .then((r) => {
        const cfg = r.config;
        setBaseConfig(cfg);
        setApproved(!!r.approved_at);
        setIsReadOnly(!!r.approved_at);
        setDateCol(cfg.date_column);
        setGranularity((cfg.granularity as "daily" | "weekly" | "monthly") ?? "monthly");
        setDimensions(cfg.dimensions ?? []);
        setFilters(cfg.filters ?? []);
        setKpiRows(configToKpiRows(cfg.kpis ?? []));
        setMappingRows(configToMappingRows(cfg.column_mappings ?? {}));
        // Kick off data integrity check immediately after load
        setTimeout(() => runConfigValidation(), 200);
      })
      .catch((e) => setError(String(e)));
  }, [recipeId]);

  // ── Auto-detect filter columns missing from column_mappings ──────────────
  useEffect(() => {
    if (!filters.length) return;
    const rawNames = new Set(mappingRows.map((r) => r.raw));
    const missing = filters.filter((f) => f && !rawNames.has(f));
    setUnsyncedFilters(missing);
  }, [filters, mappingRows]);

  // ── Validation helpers ───────────────────────────────────────────────────
  function scheduleValidation(id: number, formula: string) {
    clearTimeout(debounceTimers.current[id]);
    if (!formula.trim()) {
      setValidations((v) => ({ ...v, [id]: { status: "idle" } }));
      return;
    }
    setValidations((v) => ({ ...v, [id]: { status: "checking" } }));
    debounceTimers.current[id] = setTimeout(async () => {
      try {
        const res = await api.validateFormula(Number(recipeId), formula);
        setValidations((v) => ({
          ...v,
          [id]: {
            status: res.valid ? "valid" : "invalid",
            preview: res.preview_value,
            error: res.error,
          },
        }));
      } catch {
        setValidations((v) => ({
          ...v,
          [id]: { status: "invalid", error: "Validation request failed" },
        }));
      }
    }, 700);
  }

  async function validateAll() {
    const toValidate = kpiRows.filter(
      (r) => r.formula.trim() && (!validations[r.id] || validations[r.id].status === "idle"),
    );
    for (const row of toValidate) {
      setValidations((v) => ({ ...v, [row.id]: { status: "checking" } }));
    }
    await Promise.all(
      toValidate.map(async (row) => {
        try {
          const res = await api.validateFormula(Number(recipeId), row.formula);
          setValidations((v) => ({
            ...v,
            [row.id]: {
              status: res.valid ? "valid" : "invalid",
              preview: res.preview_value,
              error: res.error,
            },
          }));
        } catch {
          setValidations((v) => ({
            ...v,
            [row.id]: { status: "invalid", error: "Validation request failed" },
          }));
        }
      }),
    );
  }

  // ── KPI row operations ───────────────────────────────────────────────────
  function updateKpiField(id: number, field: "name" | "formula", value: string) {
    setKpiRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
    if (field === "formula") scheduleValidation(id, value);
  }

  function deleteKpi(id: number) {
    setKpiRows((rows) => rows.filter((r) => r.id !== id));
    setValidations((v) => {
      const next = { ...v };
      delete next[id];
      return next;
    });
  }

  function commitAddKpi() {
    if (!newKpiName.trim() || !newKpiFormula.trim()) return;
    const id = uid();
    setKpiRows((rows) => [...rows, {
      id,
      name: newKpiName.trim(),
      formula: newKpiFormula.trim(),
      aggregation: "",
      format: "",
    }]);
    scheduleValidation(id, newKpiFormula.trim());
    setNewKpiName("");
    setNewKpiFormula("");
    setAddingKpi(false);
    logEvent("kpi_added_in_recipe", "recipe", { name: newKpiName, formula: newKpiFormula }, { recipeId: Number(recipeId) });
  }

  // ── Mapping row operations ───────────────────────────────────────────────
  function updateMappingField(id: number, field: "raw" | "display", value: string) {
    setMappingRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  }

  function deleteMapping(id: number) {
    setMappingRows((rows) => rows.filter((r) => r.id !== id));
  }

  function commitAddMapping() {
    if (!newMapRaw.trim()) return;
    setMappingRows((rows) => [...rows, {
      id: uid(),
      raw: newMapRaw.trim(),
      display: newMapDisplay.trim() || newMapRaw.trim().replace(/_/g, " "),
    }]);
    setNewMapRaw("");
    setNewMapDisplay("");
    setAddingMap(false);
  }

  function addUnsyncedFilters() {
    const existing = new Set(mappingRows.map((r) => r.raw));
    const toAdd = unsyncedFilters.filter((f) => !existing.has(f));
    setMappingRows((rows) => [
      ...rows,
      ...toAdd.map((f) => ({
        id: uid(),
        raw: f,
        display: f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    ]);
    setUnsyncedFilters([]);
  }

  // ── Parse CSV list helper ─────────────────────────────────────────────────
  function parseList(val: string): string[] {
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // ── Save config ───────────────────────────────────────────────────────────
  async function runConfigValidation() {
    setConfigValidating(true);
    try {
      const result = await api.validateConfig(Number(recipeId));
      setConfigValidation(result);
    } catch {
      setConfigValidation(null);
    } finally {
      setConfigValidating(false);
    }
  }

  async function handleSaveConfig() {
    if (!baseConfig) return;
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      await api.updateRecipeConfig(Number(recipeId), {
        granularity,
        date_column: dateCol,
        dimensions,
        filters,
        kpis: kpiRows.map((r) => ({ name: r.name, formula: r.formula, aggregation: r.aggregation, format: r.format })),
        column_mappings: mappingRowsToRecord(mappingRows),
      });
      setSaveMsg("Configuration saved.");
      runConfigValidation();
      logEvent("recipe_config_saved", "recipe", { granularity }, { recipeId: Number(recipeId) });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  const allValidated = kpiRows.every(
    (r) => !r.formula.trim() || validations[r.id]?.status === "valid",
  );
  const hasInvalid = kpiRows.some((r) => validations[r.id]?.status === "invalid");
  const configHasErrors = configValidation != null && !configValidation.valid;
  const canApprove =
    allValidated && !hasInvalid && kpiRows.length > 0 && !configHasErrors;

  async function handleApprove() {
    if (!baseConfig || !canApprove) return;
    setApproving(true);
    setError(null);
    const patchedConfig: RecipeConfig = {
      ...baseConfig,
      granularity,
      date_column: dateCol,
      dimensions,
      filters,
      kpis: kpiRows.map((r) => ({ name: r.name, formula: r.formula, aggregation: r.aggregation, format: r.format })),
      column_mappings: mappingRowsToRecord(mappingRows),
    };
    try {
      await api.approveRecipe(Number(recipeId), patchedConfig);
      setApproved(true);
      setIsReadOnly(true);
      logEvent("recipe_approved", "recipe", { kpi_count: kpiRows.length }, { recipeId: Number(recipeId) });
    } catch (e) {
      setError(String(e));
    } finally {
      setApproving(false);
    }
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (error && !baseConfig) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </main>
    );
  }
  if (!baseConfig) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 flex items-center gap-3 text-gray-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Loading recipe…
      </main>
    );
  }

  const unvalidatedCount = kpiRows.filter(
    (r) => r.formula.trim() && (!validations[r.id] || validations[r.id].status === "idle"),
  ).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1B2340]">Report Recipe</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Edit configuration, KPIs, and column names. Validate all formulas before approving.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {approved && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              Approved
            </span>
          )}
          {approved && (
            <button
              onClick={() => { setIsReadOnly(false); setApproved(false); }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-3xl w-full px-4 py-8 space-y-8">

        {/* ── Configuration ──────────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Configuration</h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-x-8 gap-y-4 text-sm">

            <label className="text-gray-500 self-center">Date column</label>
            <input
              value={dateCol}
              onChange={(e) => setDateCol(e.target.value)}
              disabled={isReadOnly}
              placeholder="e.g. date"
              className="rounded border border-gray-200 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#00B5AD] disabled:bg-gray-50 disabled:text-gray-400"
            />

            <label className="text-gray-500 self-center">Granularity</label>
            {isReadOnly ? (
              <span className="capitalize text-gray-900">{granularity}</span>
            ) : (
              <div className="flex gap-1">
                {GRANULARITIES.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-3 py-1 rounded-lg border text-xs font-medium capitalize transition-colors ${
                      granularity === g
                        ? "bg-[#1B2340] text-white border-[#1B2340]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}

            <label className="text-gray-500 self-start pt-1">Dimensions</label>
            {isReadOnly ? (
              <span className="text-gray-900">{dimensions.join(", ") || "—"}</span>
            ) : (
              <div className="space-y-1">
                <input
                  value={dimensions.join(", ")}
                  onChange={(e) => setDimensions(parseList(e.target.value))}
                  placeholder="e.g. agent_name, team, location"
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                />
                <p className="text-[10px] text-gray-400">Comma-separated column names for breakdown charts</p>
              </div>
            )}

            <label className="text-gray-500 self-start pt-1">Filters</label>
            {isReadOnly ? (
              <span className="text-gray-900">{filters.join(", ") || "None"}</span>
            ) : (
              <div className="space-y-1">
                <input
                  value={filters.join(", ")}
                  onChange={(e) => setFilters(parseList(e.target.value))}
                  placeholder="e.g. supervisor, team"
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                />
                <p className="text-[10px] text-gray-400">Comma-separated column names shown as filter dropdowns</p>
              </div>
            )}
          </div>
        </section>

        {/* Filter sync notice */}
        {!isReadOnly && unsyncedFilters.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            <span>
              New filter column{unsyncedFilters.length > 1 ? "s" : ""}{" "}
              <strong>{unsyncedFilters.join(", ")}</strong>{" "}
              {unsyncedFilters.length > 1 ? "are" : "is"} not in Column Display Names.
            </span>
            <button
              onClick={addUnsyncedFilters}
              className="ml-4 text-xs font-semibold underline hover:no-underline flex-shrink-0"
            >
              Add display names →
            </button>
          </div>
        )}

        {/* ── KPI Definitions ────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              KPI Definitions
              {kpiRows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
                  {kpiRows.filter((r) => validations[r.id]?.status === "valid").length}/{kpiRows.length} validated
                </span>
              )}
            </h2>
            {!isReadOnly && unvalidatedCount > 0 && (
              <button
                onClick={validateAll}
                className="text-xs text-[#00B5AD] hover:underline"
              >
                Validate all ({unvalidatedCount})
              </button>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-1/4">Name</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Formula</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Status</th>
                  {!isReadOnly && <th className="px-4 py-2 w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {kpiRows.map((row) => {
                  const v = validations[row.id];
                  const rowBg =
                    v?.status === "invalid"
                      ? "bg-red-50"
                      : v?.status === "valid"
                      ? "bg-green-50/40"
                      : "";
                  return (
                    <tr key={row.id} className={rowBg}>
                      <td className="px-4 py-2">
                        <input
                          value={row.name}
                          onChange={(e) => updateKpiField(row.id, "name", e.target.value)}
                          disabled={isReadOnly}
                          className="w-full rounded border border-transparent px-1 py-0.5 text-sm focus:border-[#00B5AD] focus:outline-none focus:ring-1 focus:ring-[#00B5AD] disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={row.formula}
                          onChange={(e) => updateKpiField(row.id, "formula", e.target.value)}
                          disabled={isReadOnly}
                          placeholder="e.g. mean(csat_score)"
                          className="w-full rounded border border-transparent px-1 py-0.5 font-mono text-sm focus:border-[#00B5AD] focus:outline-none focus:ring-1 focus:ring-[#00B5AD] disabled:bg-transparent"
                        />
                        {v?.status === "invalid" && v.error && (
                          <p className="text-[10px] text-red-500 mt-0.5 px-1">{v.error}</p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <ValidationBadge v={v} formula={row.formula} />
                      </td>
                      {!isReadOnly && (
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => deleteKpi(row.id)}
                            title="Remove KPI"
                            className="text-gray-300 hover:text-red-400 text-base leading-none"
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {/* Add KPI form row */}
                {!isReadOnly && addingKpi && (
                  <tr className="bg-teal-50/40">
                    <td className="px-4 py-2">
                      <input
                        autoFocus
                        value={newKpiName}
                        onChange={(e) => setNewKpiName(e.target.value)}
                        placeholder="KPI name"
                        className="w-full rounded border border-teal-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={newKpiFormula}
                        onChange={(e) => setNewKpiFormula(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitAddKpi(); if (e.key === "Escape") { setAddingKpi(false); setNewKpiName(""); setNewKpiFormula(""); } }}
                        placeholder="e.g. contacts / dials"
                        className="w-full rounded border border-teal-300 px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                      />
                    </td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={commitAddKpi}
                          disabled={!newKpiName.trim() || !newKpiFormula.trim()}
                          className="text-xs text-[#00B5AD] font-medium hover:underline disabled:opacity-40"
                        >
                          Add
                        </button>
                        <span className="text-gray-300">·</span>
                        <button
                          onClick={() => { setAddingKpi(false); setNewKpiName(""); setNewKpiFormula(""); }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Add KPI button */}
            {!isReadOnly && !addingKpi && (
              <div className="border-t border-gray-100 px-4 py-2">
                <button
                  onClick={() => setAddingKpi(true)}
                  className="text-xs text-[#00B5AD] hover:underline font-medium"
                >
                  + Add KPI
                </button>
              </div>
            )}
          </div>

          {/* Validation legend */}
          {!isReadOnly && kpiRows.length > 0 && (
            <div className="flex items-center gap-4 text-[10px] text-gray-400 px-1">
              <span><span className="text-gray-300">●</span> Not validated</span>
              <span><span className="text-green-600">✓</span> Valid — shows preview value</span>
              <span><span className="text-red-500">✕</span> Invalid — fix before approving</span>
            </div>
          )}

          {/* Approve blocked warning */}
          {!isReadOnly && hasInvalid && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
              One or more formulas are invalid. Fix them before approving — an invalid formula will produce a blank chart.
            </div>
          )}
          {!isReadOnly && !hasInvalid && unvalidatedCount > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-700">
              {unvalidatedCount} formula{unvalidatedCount > 1 ? "s have" : " has"} not been validated yet.{" "}
              <button onClick={validateAll} className="underline font-medium">Validate all now</button>
            </div>
          )}
        </section>

        {/* ── Column display names ────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Column Display Names</h2>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-1/2">Raw column name</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Display label</th>
                  {!isReadOnly && <th className="px-4 py-2 w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappingRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2">
                      {isReadOnly ? (
                        <span className="font-mono text-gray-500 text-sm">{row.raw}</span>
                      ) : (
                        <input
                          value={row.raw}
                          onChange={(e) => updateMappingField(row.id, "raw", e.target.value)}
                          className="w-full rounded border border-transparent px-1 py-0.5 font-mono text-sm text-gray-600 focus:border-[#00B5AD] focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={row.display}
                        onChange={(e) => updateMappingField(row.id, "display", e.target.value)}
                        disabled={isReadOnly}
                        className="w-full rounded border border-transparent px-1 py-0.5 text-sm focus:border-[#00B5AD] focus:outline-none focus:ring-1 focus:ring-[#00B5AD] disabled:bg-transparent"
                      />
                    </td>
                    {!isReadOnly && (
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => deleteMapping(row.id)}
                          title="Remove mapping"
                          className="text-gray-300 hover:text-red-400 text-base leading-none"
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {/* Add mapping form row */}
                {!isReadOnly && addingMap && (
                  <tr className="bg-teal-50/40">
                    <td className="px-4 py-2">
                      <input
                        autoFocus
                        value={newMapRaw}
                        onChange={(e) => setNewMapRaw(e.target.value)}
                        placeholder="raw_column_name"
                        className="w-full rounded border border-teal-300 px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={newMapDisplay}
                        onChange={(e) => setNewMapDisplay(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitAddMapping(); if (e.key === "Escape") { setAddingMap(false); setNewMapRaw(""); setNewMapDisplay(""); } }}
                        placeholder="Human Readable Label"
                        className="w-full rounded border border-teal-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={commitAddMapping}
                          disabled={!newMapRaw.trim()}
                          className="text-xs text-[#00B5AD] font-medium hover:underline disabled:opacity-40"
                        >
                          Add
                        </button>
                        <span className="text-gray-300">·</span>
                        <button
                          onClick={() => { setAddingMap(false); setNewMapRaw(""); setNewMapDisplay(""); }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {!isReadOnly && !addingMap && (
              <div className="border-t border-gray-100 px-4 py-2">
                <button
                  onClick={() => setAddingMap(true)}
                  className="text-xs text-[#00B5AD] hover:underline font-medium"
                >
                  + Add column display name
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Data integrity check ────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Data Integrity Check
            </h2>
            <button
              onClick={runConfigValidation}
              disabled={configValidating}
              className="text-xs text-[#00B5AD] hover:underline disabled:opacity-50"
            >
              {configValidating ? "Checking…" : "Re-check"}
            </button>
          </div>

          {configValidating && !configValidation && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
              Validating config against staging data…
            </div>
          )}

          {configValidation && (
            <div className="rounded-lg border overflow-hidden text-sm">
              {/* Header */}
              <div className={`flex items-center gap-2 px-4 py-2.5 ${
                configValidation.valid ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
              } border-b`}>
                <span className={configValidation.valid ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                  {configValidation.valid ? "✓ All checks passed" : "✕ Issues found"}
                </span>
                {configValidation.details.date_span_days != null && (
                  <span className="ml-auto text-xs text-gray-500">
                    {configValidation.details.date_span_days} day span detected
                  </span>
                )}
              </div>

              {/* Errors */}
              {configValidation.errors.length > 0 && (
                <ul className="divide-y divide-red-100 bg-red-50/60">
                  {configValidation.errors.map((e, i) => (
                    <li key={i} className="flex gap-2 px-4 py-2 text-red-700">
                      <span className="flex-shrink-0 font-bold">✕</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Warnings */}
              {configValidation.warnings.length > 0 && (
                <ul className="divide-y divide-amber-100 bg-amber-50/60">
                  {configValidation.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2 px-4 py-2 text-amber-700">
                      <span className="flex-shrink-0">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}

              {configValidation.valid && configValidation.warnings.length === 0 && (
                <p className="px-4 py-2 text-green-700 bg-green-50/60">
                  Date column, filters, and all KPI formulas resolve correctly against the staging data.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Status messages ─────────────────────────────────────────────── */}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        )}
        {saveMsg && (
          <p className="rounded-lg bg-teal-50 px-4 py-2 text-sm text-teal-700">{saveMsg}</p>
        )}

        {/* ── Action bar ──────────────────────────────────────────────────── */}
        <div className="flex justify-between gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            ← Back
          </button>
          <div className="flex gap-2">
            {!isReadOnly && (
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="rounded-lg border border-[#00B5AD] px-5 py-2 text-sm font-medium text-[#00B5AD] hover:bg-teal-50 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
            {approved ? (
              <button
                onClick={() => router.push(`/dashboard/${recipeId}`)}
                className="rounded-lg bg-[#00B5AD] px-5 py-2 text-sm font-medium text-white hover:bg-[#009d96]"
              >
                View dashboard →
              </button>
            ) : (
              <button
                onClick={handleApprove}
                disabled={approving || !canApprove}
                title={
                  configHasErrors
                    ? "Fix data integrity errors before approving"
                    : hasInvalid
                    ? "Fix invalid formulas before approving"
                    : unvalidatedCount > 0
                    ? "Validate all formulas first"
                    : undefined
                }
                className="rounded-lg bg-[#1B2340] px-5 py-2 text-sm font-medium text-white hover:bg-[#243060] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {approving ? "Approving…" : "Approve recipe"}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
