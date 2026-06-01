"use client";

interface Props {
  dimensions: string[];
  filters: string[];
  activeFilters: Record<string, string>;
  filterOptions: Record<string, string[]>;
  onFilterChange: (key: string, value: string) => void;
}

export default function FilterBar({ dimensions, filters, activeFilters, filterOptions, onFilterChange }: Props) {
  const all = [...new Set([...dimensions, ...filters])];
  if (all.length === 0) return null;

  const hasActiveFilter = Object.values(activeFilters).some(Boolean);

  return (
    <div className="flex items-center gap-4 flex-wrap bg-white border-b border-gray-200 px-6 py-3">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Filter</span>
      {all.map((dim) => {
        const options = filterOptions[dim] ?? [];
        const active = !!activeFilters[dim];
        return (
          <div key={dim} className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-gray-400">{dim.replace(/_/g, " ")}</label>
            <select
              value={activeFilters[dim] ?? ""}
              onChange={(e) => onFilterChange(dim, e.target.value)}
              className={`rounded-lg border text-xs px-2 py-1.5 text-gray-700 min-w-[130px] focus:outline-none focus:ring-1 focus:ring-[#00B5AD] transition-colors ${
                active ? "border-[#00B5AD] bg-teal-50" : "border-gray-300"
              }`}
            >
              <option value="">All</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        );
      })}
      {hasActiveFilter && (
        <button
          onClick={() => all.forEach((dim) => onFilterChange(dim, ""))}
          className="text-xs text-[#00B5AD] underline self-end pb-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
