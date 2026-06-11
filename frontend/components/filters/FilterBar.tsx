"use client";

interface Props {
  dimensions: string[];
  filters: string[];
  activeFilters: Record<string, string>;
  filterOptions: Record<string, string[]>;
  onFilterChange: (key: string, value: string) => void;
}

export default function FilterBar({ dimensions, filters, activeFilters, filterOptions, onFilterChange }: Props) {
  const all = filters.length > 0 ? [...new Set(filters)] : [...new Set(dimensions)];
  if (all.length === 0) return null;

  const hasActiveFilter = Object.values(activeFilters).some(Boolean);
  const activeCount = Object.values(activeFilters).filter(Boolean).length;

  return (
    <div className="flex items-center gap-4 flex-wrap bg-card border-b border-rim px-6 py-3">
      <div className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3 text-mist">
          <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="text-[10px] font-bold text-mist uppercase tracking-[0.1em]">
          Filter
          {activeCount > 0 && (
            <span className="ml-1.5 bg-signal text-canvas rounded-full px-1.5 py-0.5 text-[8px] font-bold">
              {activeCount}
            </span>
          )}
        </span>
      </div>
      {all.map((dim) => {
        const options = filterOptions[dim] ?? [];
        const active = !!activeFilters[dim];
        return (
          <div key={dim} className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-[0.1em] text-mist font-semibold">
              {dim.replace(/_/g, " ")}
            </label>
            <select
              value={activeFilters[dim] ?? ""}
              onChange={(e) => onFilterChange(dim, e.target.value)}
              className={`rounded-lg border text-[11px] px-2.5 py-1.5 min-w-[120px] font-medium
                focus:outline-none focus:ring-1 focus:ring-signal transition-colors bg-raised
                ${active
                  ? "border-signal text-signal"
                  : "border-rim text-dim hover:border-edge"
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
          className="text-[11px] text-danger/70 hover:text-danger font-medium self-end pb-1 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
