"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ColumnTable from "@/components/ColumnTable";
import { api } from "@/lib/api";
import type { ColumnProfile, ColumnRole, ProfilingResult, SemanticTag } from "@/lib/types";

interface ColumnOverrideState {
  role?: ColumnRole;
  semanticTag?: SemanticTag;
  inGrain?: boolean;
}

interface FileTab {
  uploadId: number;
  filename: string;
  profile: ProfilingResult | null;
  overrides: Record<string, ColumnOverrideState>;
  saving: boolean;
  saved: boolean;
}

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dashboard"];

export default function SchemaPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load all upload profiles from sessionStorage (set by upload page)
  useEffect(() => {
    const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
    if (!stored) {
      setError("Session expired. Please re-upload your files.");
      setLoading(false);
      return;
    }
    const uploadIds: { uploadId: number; filename: string }[] = JSON.parse(stored);

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
        }));
      await api.saveSchemaOverrides(tab.uploadId, { column_overrides });
      setTabs((prev) => prev.map((t, i) => (i === tabIndex ? { ...t, saving: false, saved: true } : t)));
    } catch {
      setTabs((prev) => prev.map((t, i) => (i === tabIndex ? { ...t, saving: false } : t)));
    }
  }

  const activeSheet = tabs[activeTab]?.profile?.active_sheet ?? "";

  async function handleSheetChange(sheet: string) {
    const tab = tabs[activeTab];
    if (!tab) return;
    try {
      const updated = await api.saveSchemaOverrides(tab.uploadId, {
        column_overrides: [],
        active_sheet: sheet,
      });
      setTabs((prev) =>
        prev.map((t, i) => (i === activeTab ? { ...t, profile: updated } : t)),
      );
    } catch { /* ignore */ }
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
                {t.saved && <span className="ml-1 text-teal-500 text-xs">✓</span>}
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
              {tab.profile.sheet_names.length > 1 && (
                <div className="flex items-center gap-1">
                  <strong className="text-gray-700">Sheet:</strong>
                  <select
                    value={activeSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none"
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

        {/* CTA row */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-6">
          <button
            onClick={() => router.push(`/session/${datasetId}/kpis`)}
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            Skip Interview → Go to KPI Selection
          </button>
          <button
            onClick={() => router.push(`/session/${datasetId}/interview`)}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#1B2340] text-white hover:bg-[#243060]"
          >
            Continue to Interview →
          </button>
        </div>
      </div>
    </div>
  );
}
