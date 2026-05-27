"use client";

import type { KpiFeasibilityBlocked } from "@/lib/types";

const DOMAIN_COLORS: Record<string, string> = {
  collections: "bg-indigo-50 text-indigo-600",
  revenue: "bg-emerald-50 text-emerald-600",
  cx: "bg-teal-50 text-teal-600",
  workforce: "bg-purple-50 text-purple-600",
  retail: "bg-orange-50 text-orange-600",
  ops: "bg-blue-50 text-blue-600",
  generic: "bg-gray-100 text-gray-500",
};

function domainColor(domain: string) {
  const key = domain?.toLowerCase().split(/[\s_]/)[0] ?? "generic";
  return DOMAIN_COLORS[key] ?? DOMAIN_COLORS.generic;
}

interface Props {
  availableKpis: string[];
  blockedKpis: KpiFeasibilityBlocked[];
  kpiMeta: Record<string, { name: string; domain: string }>;
  selected: Set<string>;
  onToggle: (kpiId: string) => void;
}

export default function KpiSelector({ availableKpis, blockedKpis, kpiMeta, selected, onToggle }: Props) {
  return (
    <div className="space-y-8">
      {/* Available KPIs */}
      {availableKpis.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[#00B5AD]" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Available — {availableKpis.length} KPIs ready to compute
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableKpis.map((id) => {
              const meta = kpiMeta[id];
              const isSelected = selected.has(id);
              return (
                <button
                  key={id}
                  onClick={() => onToggle(id)}
                  className={`group relative rounded-xl border-2 p-4 text-left transition-all ${
                    isSelected
                      ? "border-[#00B5AD] bg-[#00B5AD]/5 shadow-sm"
                      : "border-gray-100 bg-white hover:border-[#00B5AD]/40 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-800 leading-snug">
                      {meta?.name ?? id.replace(/_/g, " ")}
                    </span>
                    {/* Checkbox indicator */}
                    <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isSelected
                        ? "border-[#00B5AD] bg-[#00B5AD]"
                        : "border-gray-300 group-hover:border-[#00B5AD]/50"
                    }`}>
                      {isSelected && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </div>
                  {meta?.domain && (
                    <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${domainColor(meta.domain)}`}>
                      {meta.domain}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Blocked KPIs */}
      {blockedKpis.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-300" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Unavailable — {blockedKpis.length} KPIs need more data
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {blockedKpis.map((blocked) => (
              <div
                key={blocked.id}
                className="rounded-xl border-2 border-dashed border-gray-200 bg-white p-4 opacity-50"
              >
                <p className="text-sm font-semibold text-gray-500">{blocked.name}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {blocked.missing_columns.map((col) => (
                    <span key={col} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {availableKpis.length === 0 && blockedKpis.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm6.75-9.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v16.5c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 019.75 19.875V3.375zm6.75 5.25c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-500">No KPIs found</p>
          <p className="mt-1 text-xs text-gray-400">
            Go back and check your column mapping — canonical names must match the KPI registry.
          </p>
        </div>
      )}
    </div>
  );
}
