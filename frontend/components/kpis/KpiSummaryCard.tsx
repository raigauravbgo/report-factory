import TrendBadge from "@/components/ui/TrendBadge";

interface Props {
  label: string;
  value: string;
  formula: string;
  trendDirection?: "up" | "down" | "flat";
  trendValue?: string;
  color?: string;
}

const ICONS: Record<number, string> = { 0: "◈", 1: "◉", 2: "◎", 3: "◍" };

export default function KpiSummaryCard({
  label,
  value,
  formula,
  trendDirection = "flat",
  trendValue,
  color = "#3b82f6",
}: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
        {trendValue && <TrendBadge value={trendValue} direction={trendDirection} />}
      </div>
      <div>
        <p className="text-3xl font-bold text-gray-900" style={{ color }}>{value}</p>
        <p className="font-mono text-xs text-gray-400 mt-1 truncate">{formula}</p>
      </div>
    </div>
  );
}
