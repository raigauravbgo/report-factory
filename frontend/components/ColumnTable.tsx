"use client";

import type { ColumnProfile, ColumnRole, SemanticTag } from "@/lib/types";

interface ColumnOverrideState {
  role?: ColumnRole;
  semanticTag?: SemanticTag;
  inGrain?: boolean;
  inFilter?: boolean;
}

interface Props {
  columns: ColumnProfile[];
  overrides: Record<string, ColumnOverrideState>;
  onOverride: (colName: string, patch: Partial<ColumnOverrideState>) => void;
  grainSuggestions?: string[];
}

const ROLE_OPTIONS: ColumnRole[] = ["date", "dimension", "measure", "ignore"];
const TAG_OPTIONS: SemanticTag[] = ["entity_key", "time_key", "financial_metric", "dimension", "text", "ignore"];

const TYPE_BADGE: Record<string, string> = {
  date: "bg-purple-100 text-purple-700",
  numeric: "bg-green-100 text-green-700",
  categorical: "bg-blue-100 text-blue-700",
  text: "bg-gray-100 text-gray-600",
};

const ROLE_BADGE: Record<ColumnRole, string> = {
  date: "bg-purple-50 text-purple-600",
  dimension: "bg-blue-50 text-blue-600",
  measure: "bg-green-50 text-green-600",
  ignore: "bg-gray-50 text-gray-400",
};

const TAG_BADGE: Record<SemanticTag, string> = {
  entity_key: "bg-indigo-50 text-indigo-600",
  time_key: "bg-purple-50 text-purple-600",
  financial_metric: "bg-emerald-50 text-emerald-700",
  dimension: "bg-blue-50 text-blue-600",
  text: "bg-gray-50 text-gray-500",
  ignore: "bg-gray-50 text-gray-400",
};

export default function ColumnTable({ columns, overrides, onOverride, grainSuggestions = [] }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Column</th>
            <th className="px-4 py-3 text-left">Detected type</th>
            <th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-left">Semantic tag</th>
            <th className="px-4 py-3 text-center">Grain</th>
            <th className="px-4 py-3 text-center">Filter</th>
            <th className="px-4 py-3 text-right">Missing</th>
            <th className="px-4 py-3 text-right">Unique</th>
            <th className="px-4 py-3 text-left">Sample values</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {columns.map((col) => {
            const ov = overrides[col.name] ?? {};
            const role = ov.role ?? col.suggested_role;
            const tag = ov.semanticTag ?? col.semantic_tag ?? "dimension";
            const grainScore = col.grain_score ?? 0;
            const isAiGrain = grainSuggestions.includes(col.name);
            const inGrain = ov.inGrain !== undefined ? ov.inGrain : (col.grain_candidate || isAiGrain);
            const inFilter = ov.inFilter !== undefined ? ov.inFilter : (col.is_filter ?? false);
            const isDirty =
              (ov.role !== undefined && ov.role !== col.suggested_role) ||
              (ov.semanticTag !== undefined && ov.semanticTag !== col.semantic_tag) ||
              (ov.inGrain !== undefined && ov.inGrain !== (col.grain_candidate || isAiGrain)) ||
              (ov.inFilter !== undefined && ov.inFilter !== (col.is_filter ?? false));

            return (
              <tr key={col.name} className={role === "ignore" ? "opacity-40" : ""}>
                <td className="px-4 py-3 font-mono font-medium text-gray-900 whitespace-nowrap">
                  {col.name}
                  {isDirty && <span className="ml-1 text-xs text-amber-500">*</span>}
                  {/* PK badge: entity_key columns that are grain candidates (≥95% unique) */}
                  {tag === "entity_key" && inGrain && (
                    <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">PK</span>
                  )}
                  {/* FK badge: entity_key columns that are NOT grain candidates (repeated values = references another table) */}
                  {tag === "entity_key" && !inGrain && (
                    <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-orange-100 text-orange-700 uppercase tracking-wide">FK</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[col.detected_type]}`}>
                    {col.detected_type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={role}
                    onChange={(e) => onOverride(col.name, { role: e.target.value as ColumnRole })}
                    className={`rounded border border-gray-200 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${ROLE_BADGE[role]}`}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={tag}
                    onChange={(e) => onOverride(col.name, { semanticTag: e.target.value as SemanticTag })}
                    className={`rounded border border-gray-200 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${TAG_BADGE[tag]}`}
                  >
                    {TAG_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t.replace("_", " ")}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${Math.round(grainScore * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={inGrain}
                        onChange={(e) => onOverride(col.name, { inGrain: e.target.checked })}
                        aria-label={`Mark ${col.name} as grain column`}
                        className="h-3 w-3 rounded accent-teal-600"
                      />
                      {isAiGrain && !ov.inGrain && (
                        <span className="text-[9px] text-teal-600 font-medium">AI</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={inFilter}
                      onChange={(e) => onOverride(col.name, { inFilter: e.target.checked })}
                      title="Mark as dashboard filter"
                      aria-label={`Mark ${col.name} as dashboard filter`}
                      className="h-3.5 w-3.5 rounded accent-[#00B5AD]"
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {col.missing_pct > 0 ? (
                    <span className={col.missing_pct > 20 ? "text-red-500" : ""}>{col.missing_pct}%</span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-gray-500">{col.unique_count.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs truncate max-w-xs">
                  {col.sample_values.slice(0, 3).map(String).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
