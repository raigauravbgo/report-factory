interface Insight {
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  finding: string;
  action?: string;
}

const SEVERITY_STYLES = {
  critical: { bar: "bg-red-500", badge: "bg-red-100 text-red-700", label: "Critical" },
  high:     { bar: "bg-orange-400", badge: "bg-orange-100 text-orange-700", label: "High" },
  medium:   { bar: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-700", label: "Medium" },
  low:      { bar: "bg-blue-400", badge: "bg-blue-100 text-blue-700", label: "Info" },
};

export default function InsightPanel({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-1 h-5 bg-[#00B5AD] rounded-full" />
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Executive Insights</h3>
      </div>
      <div className="space-y-3">
        {insights.map((ins, i) => {
          const s = SEVERITY_STYLES[ins.severity];
          return (
            <div key={i} className="flex gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
              <div className={`w-1 rounded-full flex-shrink-0 ${s.bar}`} />
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${s.badge}`}>
                    {s.label}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">{ins.headline}</p>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{ins.finding}</p>
                {ins.action && (
                  <p className="text-xs text-[#1B2340] font-medium mt-1">
                    → {ins.action}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
