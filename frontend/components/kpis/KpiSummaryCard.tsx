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
  color = "#3b82f6",
}: Props) {
  const isNull = value === "—";

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col gap-3 ${isNull ? "border-amber-100 bg-amber-50/30" : "border-gray-100"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
        {trendValue && <TrendBadge value={trendValue} direction={trendDirection} />}
      </div>
      <div>
        <p
          className={`text-3xl font-bold ${isNull ? "text-gray-300" : "text-gray-900"}`}
          style={isNull ? undefined : { color }}
          title={isNull ? "No data — the formula column may not exist in this dataset or all values are non-numeric" : undefined}
        >
          {value}
        </p>
        <p className="font-mono text-xs text-gray-400 mt-1 truncate">{formula}</p>
        {isNull && (
          <p className="text-[10px] text-amber-600 mt-1">No data · check formula column</p>
        )}
      </div>
    </div>
  );
}
