"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { RecipeConfig, KpiSpec } from "@/lib/types";

export default function DashboardPage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const router = useRouter();

  const [config, setConfig] = useState<RecipeConfig | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRecipe(Number(recipeId))
      .then((r) => {
        setConfig(r.config);
        setApprovedAt(r.approved_at);
      })
      .catch((e) => setError(String(e)));
  }, [recipeId]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 flex items-center gap-3 text-gray-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Loading dashboard…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Recipe #{recipeId}
            {approvedAt && (
              <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Approved {new Date(approvedAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push(`/recipe/${recipeId}`)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ← Edit recipe
        </button>
      </div>

      {/* Config summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Date column" value={config.date_column} mono />
        <StatCard label="Granularity" value={config.granularity} />
        <StatCard label="Dimensions" value={config.dimensions.join(", ") || "—"} />
        <StatCard label="Filters" value={config.filters.join(", ") || "None"} />
      </div>

      {/* KPI cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">KPI Definitions</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {config.kpis.map((kpi) => (
            <KpiCard key={kpi.name} kpi={kpi} />
          ))}
        </div>
      </section>

      {/* Column mappings */}
      {Object.keys(config.column_mappings).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Column Mappings</h2>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Raw column</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Display name</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(config.column_mappings).map(([raw, display]) => (
                  <tr key={raw} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 font-mono text-gray-500 text-xs">{raw}</td>
                    <td className="px-4 py-2 text-gray-900">{display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Chart layout */}
      {config.chart_layout?.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Chart Layout</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {config.chart_layout.map((chart, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-4 bg-gray-50 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{chart.title}</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{chart.type}</span>
                </div>
                <span className="text-xs text-gray-500 font-mono">{chart.kpi}</span>
                {chart.group_by && (
                  <span className="text-xs text-gray-400">grouped by {chart.group_by}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Start over */}
      <div className="pt-4 border-t border-gray-200">
        <button
          onClick={() => router.push("/upload")}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New report
        </button>
      </div>
    </main>
  );
}

function StatCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-1">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium text-gray-900 truncate ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function KpiCard({ kpi }: { kpi: KpiSpec }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-1">
      <p className="text-sm font-semibold text-gray-900">{kpi.name}</p>
      <p className="font-mono text-xs text-blue-700 bg-blue-50 rounded px-2 py-1">{kpi.formula}</p>
    </div>
  );
}
