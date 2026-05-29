"use client";

interface Props {
  dimensions: string[];
  filters: string[];
  activeFilters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}

export default function FilterBar({ dimensions, filters, activeFilters, onFilterChange }: Props) {
  const all = [...new Set([...dimensions, ...filters])];
  if (all.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap bg-white border-b border-gray-200 px-6 py-3">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide mr-1">Filter</span>
      {all.map((dim) => (
        <div key={dim} className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide text-gray-400">{dim}</label>
          <select
            value={activeFilters[dim] ?? ""}
            onChange={(e) => onFilterChange(dim, e.target.value)}
            className="rounded-lg border border-gray-300 text-xs px-2 py-1.5 text-gray-700 min-w-[120px] focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
          >
            <option value="">All</option>
          </select>
        </div>
      ))}
    </div>
  );
}
