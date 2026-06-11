import TrendBadge from "@/components/ui/TrendBadge";

interface Props {
  label: string;
  value: string;
  formula: string;
  trendDirection?: "up" | "down" | "flat";
  trendValue?: string;
  color?: string;
}

export default function KpiSummaryCard({
  label,
  value,
  formula,
  trendDirection = "flat",
  trendValue,
  color = "#3B82F6",
}: Props) {
  const isNull = value === "—";

  return (
    <div
      className={`relative bg-card rounded-xl border flex flex-col overflow-hidden transition-all duration-200
        ${isNull
          ? "border-caution/30 bg-amber-50/30"
          : "border-rim hover:border-edge hover:shadow-md shadow-sm"
        }`}
    >
      {/* Top accent stripe */}
      {!isNull && (
        <div className="h-[3px] w-full" style={{ background: color }} />
      )}

      <div className="p-4 flex flex-col gap-3">
        {/* Label + trend */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-bold text-mist uppercase tracking-[0.12em] leading-snug flex-1">{label}</p>
          {trendValue && <TrendBadge value={trendValue} direction={trendDirection} />}
        </div>

        {/* Value */}
        <div>
          <p
            className={`text-[28px] font-extrabold tracking-tight leading-none tabular-nums
              ${isNull ? "text-mist" : ""}`}
            style={isNull ? undefined : { color }}
            title={isNull ? "No data — check formula column" : undefined}
          >
            {value}
          </p>
        </div>

        {/* Formula */}
        <div className="border-t border-rim pt-2.5 flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5 flex-shrink-0 text-mist">
            <path d="M1 4h10M1 8h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <p className="font-mono text-[9px] text-mist truncate">{formula}</p>
        </div>

        {isNull && (
          <p className="text-[9px] text-caution/80 flex items-center gap-1">
            <span>⚠</span> No data · check formula column
          </p>
        )}
      </div>
    </div>
  );
}
