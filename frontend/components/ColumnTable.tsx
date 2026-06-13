"use client";

import type { ColumnProfile, ColumnRole } from "@/lib/types";

interface Props {
  columns: ColumnProfile[];
  overrides: Record<string, ColumnRole>;
  onOverride: (colName: string, role: ColumnRole) => void;
}

const ROLE_OPTIONS: ColumnRole[] = ["date", "dimension", "measure", "ignore"];

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

export default function ColumnTable({ columns, overrides, onOverride }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Column</th>
            <th className="px-4 py-3 text-left">Detected type</th>
            <th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-right">Missing</th>
            <th className="px-4 py-3 text-right">Unique</th>
            <th className="px-4 py-3 text-left">Sample values</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {columns.map((col) => {
            const role = overrides[col.name] ?? col.suggested_role;
            const isOverridden = overrides[col.name] !== undefined && overrides[col.name] !== col.suggested_role;
            return (
              <tr key={col.name} className={role === "ignore" ? "opacity-40" : ""}>
                <td className="px-4 py-3 font-mono font-medium text-gray-900">
                  {col.name}
                  {isOverridden && <span className="ml-1 text-xs text-amber-500">*</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[col.detected_type]}`}>
                    {col.detected_type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={role}
                    onChange={(e) => onOverride(col.name, e.target.value as ColumnRole)}
                    className={`rounded border border-gray-200 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${ROLE_BADGE[role]}`}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
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
