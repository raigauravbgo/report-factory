"use client";

import type { KpiSuggestion } from "@/lib/types";

const DOMAIN_COLORS: Record<string, string> = {
  collections: "bg-blue-100 text-blue-700",
  cx: "bg-purple-100 text-purple-700",
  sales: "bg-green-100 text-green-700",
  workforce: "bg-amber-100 text-amber-700",
  ops: "bg-gray-100 text-gray-700",
};

interface Props {
  kpi: KpiSuggestion;
  selected: boolean;
  onToggle: (kpiId: string) => void;
}

export default function KpiCard({ kpi, selected, onToggle }: Props) {
  const barWidth = Math.round(kpi.relevance_score * 100);
  const domainClass = DOMAIN_COLORS[kpi.domain] ?? "bg-gray-100 text-gray-600";

  return (
    <div
      onClick={() => onToggle(kpi.kpi_id)}
      className={[
        "cursor-pointer rounded-lg border px-4 py-3 transition-all",
        selected
          ? "border-blue-400 bg-blue-50 shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            selected ? "border-blue-500 bg-blue-500 text-white" : "border-gray-300",
          ].join(" ")}
        >
          {selected && (
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800 text-sm truncate">{kpi.display_name}</span>
            <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${domainClass}`}>
              {kpi.domain}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-gray-400 truncate">{kpi.formula}</p>

          {/* Relevance bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-gray-100">
              <div
                className="h-1.5 rounded-full bg-blue-400 transition-all"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-gray-400">{barWidth}%</span>
          </div>

          {/* Reasoning (collapsed by default via title tooltip) */}
          <p className="mt-1 text-xs text-gray-400 truncate" title={kpi.reasoning}>
            {kpi.reasoning}
          </p>
        </div>
      </div>
    </div>
  );
}
