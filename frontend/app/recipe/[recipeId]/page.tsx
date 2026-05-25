"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { KpiSpec, RecipeConfig } from "@/lib/types";

export default function RecipePage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [config, setConfig] = useState<RecipeConfig | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRecipe(Number(recipeId))
      .then((r) => {
        setConfig(r.config);
        setApproved(!!r.approved_at);
      })
      .catch((e) => setError(String(e)));
  }, [recipeId]);

  function updateKpi(index: number, field: keyof KpiSpec, value: string) {
    if (!config) return;
    const kpis = config.kpis.map((k, i) =>
      i === index ? { ...k, [field]: value } : k
    );
    setConfig({ ...config, kpis });
  }

  function updateMapping(raw: string, display: string) {
    if (!config) return;
    setConfig({ ...config, column_mappings: { ...config.column_mappings, [raw]: display } });
  }

  async function handleApprove() {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      await api.approveRecipe(Number(recipeId), config);
      setApproved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (error) {
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
    <main className="mx-auto max-w-3xl px-4 py-12 space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Report recipe</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and edit the configuration before approving.
          </p>
        </div>
        {approved && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            Approved
          </span>
        )}
      </div>

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

      {/* KPI definitions */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">KPI definitions</h2>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600 w-1/3">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Formula</th>
              </tr>
            </thead>
            <tbody>
              {config.kpis.map((kpi, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2">
                    <input
                      value={kpi.name}
                      onChange={(e) => updateKpi(i, "name", e.target.value)}
                      disabled={approved}
                      className="w-full rounded border border-transparent px-1 py-0.5 font-mono text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-transparent"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={kpi.formula}
                      onChange={(e) => updateKpi(i, "formula", e.target.value)}
                      disabled={approved}
                      className="w-full rounded border border-transparent px-1 py-0.5 font-mono text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-transparent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Column display names */}
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
              {Object.entries(config.column_mappings).map(([raw, display]) => (
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

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ← Back
        </button>
        {approved ? (
          <button
            onClick={() => router.push(`/dashboard/${recipeId}`)}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            View dashboard →
          </button>
        ) : (
          <button
            onClick={handleApprove}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Approving…" : "Approve recipe"}
          </button>
        )}
      </div>
    </main>
  );
}
