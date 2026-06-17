"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const [sheetChanging, setSheetChanging] = useState(false);
  const sheetChangingRef = useRef(false); // synchronous guard; state alone has async update lag
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
    if (!tab || sheetChangingRef.current) return;
    sheetChangingRef.current = true;
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
    finally {
      sheetChangingRef.current = false;
      setSheetChanging(false);
    }
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
      <div className="flex items-center justify-center h-64 text-[12px] text-dim gap-3">
        <span className="animate-spin h-4 w-4 border-2 border-signal border-t-transparent rounded-full" />
        Loading profiles…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl bg-danger/5 border border-danger/25 px-5 py-4 text-[12px] text-danger flex items-start gap-2">
          <span>⚠</span> {error}
        </div>
      </div>
    );
  }

  const tab = tabs[activeTab];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-rim px-6 py-4">
        <h1 className="text-[15px] font-bold text-ink tracking-tight">Schema Mapping</h1>
        <p className="text-[11px] text-mist mt-0.5">Review AI-detected column roles and grain. Edit any column before continuing.</p>
      </div>

      {/* Step indicator */}
      <div className="bg-card border-b border-rim px-6 py-3">
        <div className="flex items-center gap-1.5">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors
                  ${i === 1
                    ? "bg-[#1B2340] text-white border-[#1B2340]"
                    : i < 1
                    ? "bg-grow/10 text-grow border-grow/25"
                    : "bg-raised text-mist border-rim"}`}
              >
                {i < 1 ? (
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

      <div className="flex-1 px-6 py-6 space-y-6 max-w-7xl w-full mx-auto">

        {/* File tabs */}
        <div className="border-b border-rim">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((t, i) => (
              <button
                key={t.uploadId}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  i === activeTab
                    ? "border-ink text-ink"
                    : "border-transparent text-mist hover:text-dim"
                }`}
              >
                {t.filename}
                {t.profile === null && <span className="ml-1 text-danger text-[10px]" title="Profile failed to load">⚠</span>}
                {t.saved && <span className="ml-1 text-grow text-[10px]">✓</span>}
                {t.profile?.table_type === "dimension" && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-royal/10 text-royal border border-royal/20">Dimension</span>
                )}
                {t.profile?.table_type === "fact" && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-azure/10 text-azure border border-azure/20">Fact</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {tab && tab.profile ? (
          <>
            {/* File metadata bar */}
            <div className="flex flex-wrap items-center gap-4 bg-raised border border-rim rounded-lg px-4 py-3 text-[11px] text-dim">
              <span><strong className="text-ink">Rows:</strong> {tab.profile.row_count.toLocaleString()}</span>
              <span><strong className="text-ink">Cols:</strong> {tab.profile.columns.length}</span>
              <span><strong className="text-ink">Duplicates:</strong> {tab.profile.duplicate_row_count.toLocaleString()}</span>
              {tab.profile.encoding && (
                <span><strong className="text-ink">Encoding:</strong> {tab.profile.encoding}</span>
              )}
              {tab.profile.delimiter && (
                <span><strong className="text-ink">Delimiter:</strong> <code className="bg-wash border border-rim px-1 rounded font-mono text-[10px]">{tab.profile.delimiter === "\t" ? "TAB" : tab.profile.delimiter}</code></span>
              )}
              <div className="flex items-center gap-1.5">
                <strong className="text-ink">Table type:</strong>
                <select
                  value={tab.profile.table_type ?? "unknown"}
                  onChange={(e) =>
                    handleTableTypeChange(activeTab, e.target.value as "fact" | "dimension" | "unknown")
                  }
                  className="text-[11px] border border-rim rounded-lg px-2 py-1 bg-card focus:outline-none focus:border-signal focus:ring-1 focus:ring-signal/20 hover:border-edge transition-colors"
                  title="AI-suggested classification — change if incorrect"
                >
                  <option value="fact">Fact</option>
                  <option value="dimension">Dimension</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              {tab.profile.sheet_names.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <strong className="text-ink">Sheet:</strong>
                  <select
                    value={activeSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    disabled={sheetChanging}
                    className="text-[11px] border border-rim rounded-lg px-2 py-1 bg-card focus:outline-none focus:border-signal hover:border-edge transition-colors disabled:opacity-50"
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
              <div className="flex items-start gap-2.5 bg-signal/5 border border-signal/20 rounded-lg px-4 py-3 text-[11px] text-signal">
                <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.6"/>
                  <path d="M7 4.5v3M7 9v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span><span className="font-bold">AI grain suggestion:</span> {tab.profile.grain_suggestions.join(" + ")}</span>
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
                className={`px-4 py-2 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50
                  ${tab.saved
                    ? "bg-grow/10 text-grow border border-grow/25"
                    : "bg-raised text-dim border border-rim hover:bg-wash hover:border-edge"
                  }`}
              >
                {tab.saving ? (
                  <span className="flex items-center gap-1.5">
                    <span className="animate-spin h-3 w-3 border-2 border-signal border-t-transparent rounded-full" />
                    Saving…
                  </span>
                ) : tab.saved ? "Saved ✓" : "Save overrides"}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl bg-danger/5 border border-danger/25 px-4 py-3 text-[12px] text-danger">
            Could not load profile for this file.
          </div>
        )}

        {/* Cross-file relationships — only shown when 2+ files are profiled */}
        {tabs.filter((t) => t.profile !== null).length > 1 && (
          <div className="space-y-3 border-t border-rim pt-6">
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Cross-File Relationships</h3>
              <p className="text-[11px] text-mist mt-0.5">
                AI-detected Primary Key → Foreign Key links across your files. Confirm the joins
                to use when computing cross-file KPIs.
              </p>
            </div>
            {relLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-dim">
                <span className="animate-spin h-4 w-4 border-2 border-signal border-t-transparent rounded-full flex-shrink-0" />
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
          <div className="text-[11px] bg-caution/5 border border-caution/20 rounded-lg px-4 py-3 text-caution space-y-2.5">
            <div className="text-dim">
              <span className="font-semibold text-ink">No dimension table detected.</span>{" "}
              Filters like <span className="font-medium">location</span> and{" "}
              <span className="font-medium">department</span> will be sourced directly from your
              fact tables — this works fine for those columns. If you have a separate employee or
              roster file, mark it as <span className="font-medium">&quot;Dimension&quot;</span> using the
              Table type dropdown above.
            </div>

            {/* Virtual dimension builder */}
            {!vdResult ? (
              <div className="flex items-center gap-3 pt-0.5">
                <button
                  onClick={handleBuildVirtualDimension}
                  disabled={vdBuilding}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-caution text-white font-semibold hover:bg-caution/90 disabled:opacity-50 transition-colors"
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
                <span className="text-[10px] text-dim">
                  AI extracts shared attributes from your fact tables to enable dimension-based filters.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-0.5 bg-grow/5 border border-grow/20 rounded-lg px-3 py-2 text-grow">
                <span>✓</span>
                <span className="text-dim">
                  <span className="font-semibold text-grow">Virtual dimension built</span> — {vdResult.row_count} rows,{" "}
                  {vdResult.columns.length} columns:{" "}
                  <span className="font-mono text-[10px]">{vdResult.columns.slice(0, 5).join(", ")}{vdResult.columns.length > 5 ? "…" : ""}</span>
                </span>
              </div>
            )}
            {vdError && (
              <p className="text-danger text-[11px] mt-1">{vdError}</p>
            )}
          </div>
        )}

        {/* CTA row */}
        <div className="flex items-center justify-between border-t border-rim pt-6">
          <button
            onClick={() => handleNavigate(`/session/${datasetId}/kpis`)}
            disabled={navigating}
            className="text-[11px] text-mist hover:text-signal underline underline-offset-2 disabled:opacity-50 transition-colors"
          >
            {navigating ? "Saving…" : "Skip Interview → Go to KPI Selection"}
          </button>
          <button
            onClick={() => handleNavigate(`/session/${datasetId}/interview`)}
            disabled={navigating}
            className="px-5 py-2.5 rounded-xl text-[12px] font-semibold bg-signal text-white hover:bg-signal/90 disabled:opacity-50 shadow-sm transition-all"
          >
            {navigating ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Saving…
              </span>
            ) : "Continue to Interview →"}
          </button>
        </div>
      </div>
    </div>
  );
}
