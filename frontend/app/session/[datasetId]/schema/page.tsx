"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ColumnTable from "@/components/ColumnTable";
import SchemaRelationships from "@/components/SchemaRelationships";
import { api } from "@/lib/api";
import type { ColumnProfile, ColumnRole, ProfilingResult, RelationshipSuggestion, SemanticTag } from "@/lib/types";

interface ColumnOverrideState {
  role?: ColumnRole;
  semanticTag?: SemanticTag;
  inGrain?: boolean;
  inFilter?: boolean;
}

interface FileTab {
  uploadId: number;
  filename: string;
  profile: ProfilingResult | null;
  overrides: Record<string, ColumnOverrideState>;
  saving: boolean;
  saved: boolean;
}

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dimensions", "Dashboard"];

export default function SchemaPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [sheetChanging, setSheetChanging] = useState(false); // M3: prevent concurrent sheet changes
  const [relationships, setRelationships] = useState<RelationshipSuggestion[]>([]);
  const [relLoading, setRelLoading] = useState(false);
  const [vdBuilding, setVdBuilding] = useState(false);
  const [vdResult, setVdResult] = useState<{ columns: string[]; row_count: number } | null>(null);
  const [vdError, setVdError] = useState<string | null>(null);

  // Load all upload profiles from sessionStorage (set by upload page)
  useEffect(() => {
    const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
    if (!stored) {
      setError("Session expired. Please re-upload your files.");
      setLoading(false);
      return;
    }
    let uploadIds: { uploadId: number; filename: string }[];
    try {
      uploadIds = JSON.parse(stored);
    } catch {
      setError("Session data is corrupted. Please re-upload your files.");
      setLoading(false);
      return;
    }

    Promise.all(
      uploadIds.map(async (u) => {
        try {
          const profile = await api.getProfile(u.uploadId);
          return {
            uploadId: u.uploadId,
            filename: u.filename,
            profile,
            overrides: {} as Record<string, ColumnOverrideState>,
            saving: false,
            saved: false,
          };
        } catch {
          return {
            uploadId: u.uploadId,
            filename: u.filename,
            profile: null,
            overrides: {},
            saving: false,
            saved: false,
          };
        }
      }),
    ).then((results) => {
      setTabs(results);
      setLoading(false);

      // If multiple files were uploaded, auto-detect cross-file PK/FK relationships.
      // The SchemaRelationships component will display them and let the user confirm
      // which ones to use as join keys before generating the dashboard.
      const profiledCount = results.filter((r) => r.profile !== null).length;
      if (profiledCount > 1) {
        setRelLoading(true);
        api.getRelationships(Number(datasetId))
          .then((rels) => {
            setRelationships(rels);
            sessionStorage.setItem(
              `dataset_${datasetId}_relationships`,
              JSON.stringify(rels),
            );
          })
          .catch(() => {})
          .finally(() => setRelLoading(false));
      }
    });
  }, [datasetId]);

  function handleOverride(tabIndex: number, colName: string, patch: Partial<ColumnOverrideState>) {
    setTabs((prev) =>
      prev.map((t, i) =>
        i === tabIndex
          ? { ...t, overrides: { ...t.overrides, [colName]: { ...t.overrides[colName], ...patch } }, saved: false }
          : t,
      ),
    );
  }

  async function handleSaveTab(tabIndex: number) {
    const tab = tabs[tabIndex];
    if (!tab.profile) return;

    setTabs((prev) => prev.map((t, i) => (i === tabIndex ? { ...t, saving: true } : t)));
    try {
      const column_overrides = tab.profile.columns
        .filter((c) => tab.overrides[c.name])
        .map((c) => ({
          name: c.name,
          ...tab.overrides[c.name],
          // map camelCase → snake_case for API
          suggested_role: tab.overrides[c.name]?.role,
          semantic_tag: tab.overrides[c.name]?.semanticTag,
          in_grain: tab.overrides[c.name]?.inGrain,
          in_filter: tab.overrides[c.name]?.inFilter,
        }));
      await api.saveSchemaOverrides(tab.uploadId, { column_overrides });
      setTabs((prev) => prev.map((t, i) => (i === tabIndex ? { ...t, saving: false, saved: true } : t)));
    } catch {
      setTabs((prev) => prev.map((t, i) => (i === tabIndex ? { ...t, saving: false } : t)));
    }
  }

  function handleConfirmRelationships(confirmed: RelationshipSuggestion[]) {
    sessionStorage.setItem(`dataset_${datasetId}_relationships`, JSON.stringify(confirmed));
    setRelationships(confirmed);
  }

  async function handleNavigate(to: string) {
    setNavigating(true);
    try {
      // Auto-save all tabs that have unsaved overrides so is_filter reaches the backend
      // H15: Sequential saves prevent partial-save race condition from Promise.all
      const pending = tabs
        .map((t, i) => ({ tab: t, index: i }))
        .filter(({ tab }) => tab.profile && Object.keys(tab.overrides).length > 0);
      for (const { index } of pending) {
        await handleSaveTab(index);
      }
    } catch {
      // ignore save errors — navigate anyway
    }
    // When skipping the interview, call the skip endpoint so the heuristic result
    // (date column, dimensions, filters from schema) is stored in sessionStorage.
    // This ensures KPI suggestions receive domain context and generateDashboard
    // has the correct interview_result even without going through the interview page.
    if (to.includes("/kpis")) {
      try {
        const skipResult = await api.skipInterview(Number(datasetId));
        sessionStorage.setItem(`dataset_${datasetId}_interview`, JSON.stringify(skipResult));
      } catch {
        // non-fatal: session_generator.py heuristic fallback covers this
      }
    }
    router.push(to);
  }

  const activeSheet = tabs[activeTab]?.profile?.active_sheet ?? "";

  async function handleTableTypeChange(tabIndex: number, newType: "fact" | "dimension" | "unknown") {
    const tab = tabs[tabIndex];
    if (!tab) return;
    try {
      await api.updateTableType(tab.uploadId, newType);
      setTabs((prev) =>
        prev.map((t, i) =>
          i === tabIndex && t.profile
            ? { ...t, profile: { ...t.profile, table_type: newType } }
            : t,
        ),
      );
    } catch {
      // ignore — best-effort, UI already reflects local state
    }
  }

  async function handleSheetChange(sheet: string) {
    const tab = tabs[activeTab];
    // M3: Guard against concurrent requests from rapid sheet changes
    if (!tab || sheetChanging) return;
    setSheetChanging(true);
    try {
      const updated = await api.saveSchemaOverrides(tab.uploadId, {
        column_overrides: [],
        active_sheet: sheet,
      });
      setTabs((prev) =>
        prev.map((t, i) => (i === activeTab ? { ...t, profile: updated } : t)),
      );
    } catch { /* ignore */ }
    finally { setSheetChanging(false); }
  }

  async function handleBuildVirtualDimension() {
    setVdBuilding(true);
    setVdError(null);
    try {
      const res = await api.buildVirtualDimension(Number(datasetId));
      setVdResult({ columns: res.columns, row_count: res.row_count });
    } catch (e) {
      setVdError(String(e));
    } finally {
      setVdBuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        <span className="animate-spin h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full mr-3" />
        Loading profiles…
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-sm text-red-500">{error}</div>;
  }

  const tab = tabs[activeTab];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-lg font-bold text-[#1B2340]">Schema Mapping</h1>
        <p className="text-xs text-gray-400 mt-0.5">Review AI-detected column roles and grain. Edit any column before continuing.</p>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6 max-w-7xl w-full mx-auto">

        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                ${i === 1 ? "bg-[#1B2340] text-white" : i < 1 ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                {i < 1 ? "✓" : i + 1}
              </div>
              <span className={i === 1 ? "text-[#1B2340] font-semibold" : i < 1 ? "text-teal-600" : "text-gray-400"}>{step}</span>
              {i < STEPS.length - 1 && <span className="text-gray-200 mx-1">›</span>}
            </div>
          ))}
        </div>

        {/* File tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((t, i) => (
              <button
                key={t.uploadId}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  i === activeTab
                    ? "border-[#1B2340] text-[#1B2340]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {t.filename}
                {/* M2: Show error indicator upfront so user sees which tabs failed */}
                {t.profile === null && <span className="ml-1 text-red-400 text-xs" title="Profile failed to load">⚠</span>}
                {t.saved && <span className="ml-1 text-teal-500 text-xs">✓</span>}
                {t.profile?.table_type === "dimension" && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">Dimension</span>
                )}
                {t.profile?.table_type === "fact" && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">Fact</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {tab && tab.profile ? (
          <>
            {/* File metadata bar */}
            <div className="flex flex-wrap items-center gap-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
              <span><strong className="text-gray-700">Rows:</strong> {tab.profile.row_count.toLocaleString()}</span>
              <span><strong className="text-gray-700">Cols:</strong> {tab.profile.columns.length}</span>
              <span><strong className="text-gray-700">Duplicates:</strong> {tab.profile.duplicate_row_count.toLocaleString()}</span>
              {tab.profile.encoding && (
                <span><strong className="text-gray-700">Encoding:</strong> {tab.profile.encoding}</span>
              )}
              {tab.profile.delimiter && (
                <span><strong className="text-gray-700">Delimiter:</strong> <code className="bg-gray-100 px-1 rounded">{tab.profile.delimiter === "\t" ? "TAB" : tab.profile.delimiter}</code></span>
              )}
              <div className="flex items-center gap-1">
                <strong className="text-gray-700">Table type:</strong>
                <select
                  value={tab.profile.table_type ?? "unknown"}
                  onChange={(e) =>
                    handleTableTypeChange(activeTab, e.target.value as "fact" | "dimension" | "unknown")
                  }
                  className="text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#1B2340]"
                  title="AI-suggested classification — change if incorrect"
                >
                  <option value="fact">Fact</option>
                  <option value="dimension">Dimension</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              {tab.profile.sheet_names.length > 1 && (
                <div className="flex items-center gap-1">
                  <strong className="text-gray-700">Sheet:</strong>
                  <select
                    value={activeSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    disabled={sheetChanging}
                    className="text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none disabled:opacity-50"
                  >
                    {tab.profile.sheet_names.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Grain suggestions */}
            {tab.profile.grain_suggestions.length > 0 && (
              <div className="flex items-start gap-2 bg-teal-50 border border-teal-100 rounded-lg px-4 py-3 text-xs text-teal-700">
                <span className="font-semibold mt-0.5">AI grain suggestion:</span>
                <span>{tab.profile.grain_suggestions.join(" + ")}</span>
              </div>
            )}

            {/* Column table */}
            <ColumnTable
              columns={tab.profile.columns}
              overrides={tab.overrides}
              onOverride={(name, patch) => handleOverride(activeTab, name, patch)}
              grainSuggestions={tab.profile.grain_suggestions}
            />

            {/* Save tab */}
            <div className="flex justify-end">
              <button
                onClick={() => handleSaveTab(activeTab)}
                disabled={tab.saving}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                {tab.saving ? "Saving…" : tab.saved ? "Saved ✓" : "Save overrides"}
              </button>
            </div>
          </>
        ) : (
          <div className="text-sm text-red-500 p-4">Could not load profile for this file.</div>
        )}

        {/* Cross-file relationships — only shown when 2+ files are profiled */}
        {tabs.filter((t) => t.profile !== null).length > 1 && (
          <div className="space-y-3 border-t border-gray-100 pt-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Cross-File Relationships</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                AI-detected Primary Key → Foreign Key links across your files. Confirm the joins
                to use when computing cross-file KPIs.
              </p>
            </div>
            {relLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="animate-spin h-4 w-4 border-2 border-teal-500 border-t-transparent rounded-full flex-shrink-0" />
                Detecting relationships…
              </div>
            ) : (
              <SchemaRelationships
                suggestions={relationships}
                onConfirm={handleConfirmRelationships}
              />
            )}
          </div>
        )}

        {/* No-dimension notice — shown when all uploaded files are classified as fact/unknown */}
        {tabs.length > 0 && tabs.filter((t) => t.profile?.table_type === "dimension").length === 0 && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800 space-y-2">
            <div>
              <span className="font-semibold">No dimension table detected.</span>{" "}
              Filters like <span className="font-medium">location</span> and{" "}
              <span className="font-medium">department</span> will be sourced directly from your
              fact tables — this works fine for those columns. If you have a separate employee or
              roster file, mark it as <span className="font-medium">&quot;Dimension&quot;</span> using the
              Table type dropdown above.
            </div>

            {/* Virtual dimension builder */}
            {!vdResult ? (
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleBuildVirtualDimension}
                  disabled={vdBuilding}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-700 text-white font-medium hover:bg-amber-800 disabled:opacity-50 transition-colors"
                >
                  {vdBuilding ? (
                    <span className="flex items-center gap-1.5">
                      <span className="animate-spin h-3 w-3 border border-white border-t-transparent rounded-full" />
                      Building…
                    </span>
                  ) : (
                    "Build Virtual Dimension"
                  )}
                </button>
                <span className="text-amber-700">
                  AI extracts shared agent attributes from your fact tables to enable dimension-based filters.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1 text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                <span className="text-green-600">✓</span>
                <span>
                  <span className="font-semibold">Virtual dimension built</span> — {vdResult.row_count} agents,{" "}
                  {vdResult.columns.length} columns:{" "}
                  <span className="font-mono">{vdResult.columns.slice(0, 5).join(", ")}{vdResult.columns.length > 5 ? "…" : ""}</span>
                </span>
              </div>
            )}
            {vdError && (
              <p className="text-red-600 mt-1">{vdError}</p>
            )}
          </div>
        )}

        {/* CTA row */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-6">
          <button
            onClick={() => handleNavigate(`/session/${datasetId}/kpis`)}
            disabled={navigating}
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2 disabled:opacity-50"
          >
            {navigating ? "Saving…" : "Skip Interview → Go to KPI Selection"}
          </button>
          <button
            onClick={() => handleNavigate(`/session/${datasetId}/interview`)}
            disabled={navigating}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#1B2340] text-white hover:bg-[#243060] disabled:opacity-50"
          >
            {navigating ? "Saving…" : "Continue to Interview →"}
          </button>
        </div>
      </div>
    </div>
  );
}
