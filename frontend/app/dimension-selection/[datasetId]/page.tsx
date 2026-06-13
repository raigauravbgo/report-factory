"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { DimensionSuggestion } from "@/lib/types";

interface PageProps {
  params: Promise<{ datasetId: string }>;
}

export default function DimensionSelectionPage({ params }: PageProps) {
  const { datasetId } = use(params);
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<DimensionSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDimensionSuggestions(Number(datasetId))
      .then((res) => {
        setSuggestions(res.suggestions);
        // Pre-select recommended dimensions
        setSelected(new Set(res.suggestions.filter((d) => d.is_recommended).map((d) => d.column_name)));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [datasetId]);

  function toggle(colName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  }

  async function handleGenerate() {
    setSaving(true);
    try {
      await api.selectDimensions(Number(datasetId), [...selected]);
      const recipe = await api.createRecipeFromContext(Number(datasetId));
      // Go directly to dashboard; user can click "Edit recipe" if they need to adjust
      router.push(`/dashboard/${recipe.id}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  // Group by table
  const byTable = suggestions.reduce<Record<string, DimensionSuggestion[]>>((acc, d) => {
    (acc[d.table_name] = acc[d.table_name] ?? []).push(d);
    return acc;
  }, {});

  if (loading) return <CentreSpinner label="Loading dimensions…" />;
  if (error) return <ErrorBox message={error} />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dimension Selection</h1>
          <p className="mt-1 text-sm text-gray-500">
            Select the dimensions to use for filtering and grouping in your dashboard.
            Only columns from your dimension tables are shown.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{selected.size} selected</span>
          <button
            onClick={handleGenerate}
            disabled={saving || selected.size === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Generating…" : "Generate Dashboard →"}
          </button>
        </div>
      </div>

      {Object.keys(byTable).length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
          No dimension columns found. Make sure at least one table is classified as a Dimension table in the Data Modeling step.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byTable).map(([tableName, dims]) => (
            <section key={tableName}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-600">
                <span className="inline-flex items-center rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                  dim
                </span>
                {tableName}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {dims.map((d) => {
                  const isSelected = selected.has(d.column_name);
                  return (
                    <label
                      key={d.column_name}
                      className={[
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-all",
                        isSelected
                          ? "border-blue-400 bg-blue-50"
                          : "border-gray-200 bg-white hover:border-gray-300",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(d.column_name)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 text-sm">{d.display_label}</p>
                        <p className="font-mono text-xs text-gray-400 truncate">{d.column_name}</p>
                        <p className="mt-0.5 text-xs text-gray-400 truncate" title={d.reasoning}>
                          {d.reasoning}
                        </p>
                        {d.is_recommended && (
                          <span className="mt-1 inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                            recommended
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
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
