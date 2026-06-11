"use client";

import type { ColumnSchemaEntry, SchemaDetectedType, SchemaRole } from "@/lib/types";

const TYPE_COLORS: Record<SchemaDetectedType, string> = {
  int: "bg-violet-100 text-violet-700",
  float: "bg-blue-100 text-blue-700",
  boolean: "bg-pink-100 text-pink-700",
  text: "bg-gray-100 text-gray-700",
  date: "bg-green-100 text-green-700",
};

const ROLE_COLORS: Record<SchemaRole, string> = {
  measure: "bg-orange-100 text-orange-700",
  date: "bg-green-100 text-green-700",
  dimension: "bg-indigo-100 text-indigo-700",
  boolean: "bg-pink-100 text-pink-700",
};

const TYPES: SchemaDetectedType[] = ["int", "float", "boolean", "text", "date"];
const ROLES: SchemaRole[] = ["measure", "date", "dimension", "boolean"];

interface Override {
  column_name: string;
  detected_type?: SchemaDetectedType;
  role?: SchemaRole;
  is_filter_candidate?: boolean;
}

interface Props {
  columns: ColumnSchemaEntry[];
  overrides: Record<string, Override>;
  onTypeChange: (colName: string, type: SchemaDetectedType) => void;
  onRoleChange: (colName: string, role: SchemaRole) => void;
  onFilterChange: (colName: string, isFilter: boolean) => void;
}

export default function SchemaColumnTable({
  columns,
  overrides,
  onTypeChange,
  onRoleChange,
  onFilterChange,
}: Props) {
  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[520px] rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Column</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Filter?</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Missing%</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Unique</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Samples</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {columns.map((col) => {
            const ov = overrides[col.column_name] ?? {};
            const effectiveType = (ov.detected_type ?? col.effective_type) as SchemaDetectedType;
            const effectiveRole = (ov.role ?? col.effective_role) as SchemaRole;
            const effectiveFilter = ov.is_filter_candidate ?? col.effective_is_filter;
            const isOverridden =
              ov.detected_type !== undefined || ov.role !== undefined || ov.is_filter_candidate !== undefined;

            return (
              <tr key={col.column_name} className={isOverridden ? "bg-amber-50" : undefined}>
                <td className="px-4 py-2 font-mono font-medium text-gray-800">
                  {col.column_name}
                  {isOverridden && (
                    <span className="ml-1 text-xs text-amber-600" title="User override">*</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={effectiveType}
                    onChange={(e) => onTypeChange(col.column_name, e.target.value as SchemaDetectedType)}
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_COLORS[effectiveType]}`}
                  >
                    {effectiveType}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <select
                    value={effectiveRole}
                    onChange={(e) => onRoleChange(col.column_name, e.target.value as SchemaRole)}
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${ROLE_COLORS[effectiveRole]}`}
                  >
                    {effectiveRole}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={effectiveFilter}
                    onChange={(e) => onFilterChange(col.column_name, e.target.checked)}
                    disabled={effectiveRole !== "dimension"}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-30"
                  />
                </td>
                <td className="px-4 py-2 text-right text-gray-500">{col.missing_pct.toFixed(1)}%</td>
                <td className="px-4 py-2 text-right text-gray-500">{col.unique_count}</td>
                <td className="px-4 py-2">
                  <span className="truncate text-xs text-gray-400">
                    {(col.sample_values ?? []).slice(0, 3).join(", ")}
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
