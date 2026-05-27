"use client";

import type { ColumnProfile, ColumnRole } from "@/lib/types";

interface Props {
  columns: ColumnProfile[];
  overrides: Record<string, ColumnRole>;
  onOverride: (colName: string, role: ColumnRole) => void;
}

const ROLE_OPTIONS: ColumnRole[] = ["date", "dimension", "measure", "ignore"];

const TYPE_BADGE: Record<string, string> = {
  date:        "bg-purple-50 text-purple-700 border border-purple-100",
  numeric:     "bg-emerald-50 text-emerald-700 border border-emerald-100",
  categorical: "bg-[#00B5AD]/10 text-[#00897B] border border-[#00B5AD]/20",
  text:        "bg-gray-100 text-gray-500 border border-gray-200",
};

const ROLE_SELECT: Record<ColumnRole, string> = {
  date:      "bg-purple-50 text-purple-700 border-purple-200",
  dimension: "bg-[#00B5AD]/10 text-[#00897B] border-[#00B5AD]/30",
  measure:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  ignore:    "bg-gray-50 text-gray-400 border-gray-200",
};

export default function ColumnTable({ columns, overrides, onOverride }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-50 text-sm">
        <thead className="bg-gray-50/70">
          <tr>
            {["Column", "Detected type", "Role", "Missing", "Unique", "Sample values"].map((h, i) => (
              <th
                key={h}
                className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${
                  i >= 3 && i <= 4 ? "text-right" : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {columns.map((col, idx) => {
            const role = overrides[col.name] ?? col.suggested_role;
            const isOverridden =
              overrides[col.name] !== undefined && overrides[col.name] !== col.suggested_role;
            const isIgnored = role === "ignore";

            return (
              <tr
                key={col.name}
                className={`transition-colors hover:bg-gray-50/60 ${isIgnored ? "opacity-40" : ""} ${idx % 2 === 0 ? "" : "bg-gray-50/20"}`}
              >
                {/* Column name */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-gray-800">{col.name}</span>
                    {isOverridden && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">
                        edited
                      </span>
                    )}
                  </div>
                </td>

                {/* Detected type badge */}
                <td className="px-4 py-2.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[col.detected_type] ?? TYPE_BADGE.text}`}>
                    {col.detected_type}
                  </span>
                </td>

                {/* Role selector */}
                <td className="px-4 py-2.5">
                  <select
                    value={role}
                    onChange={(e) => onOverride(col.name, e.target.value as ColumnRole)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-[#00B5AD] ${ROLE_SELECT[role]}`}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>

                {/* Missing % */}
                <td className="px-4 py-2.5 text-right">
                  {col.missing_pct > 0 ? (
                    <span className={`text-xs font-medium ${col.missing_pct > 20 ? "text-red-500" : "text-gray-400"}`}>
                      {col.missing_pct}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-200">—</span>
                  )}
                </td>

                {/* Unique count */}
                <td className="px-4 py-2.5 text-right">
                  <span className="text-xs text-gray-400">{col.unique_count.toLocaleString()}</span>
                </td>

                {/* Sample values */}
                <td className="max-w-xs truncate px-4 py-2.5">
                  <span className="font-mono text-[11px] text-gray-400">
                    {col.sample_values.slice(0, 3).map(String).join(", ")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
