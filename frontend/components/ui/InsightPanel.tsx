interface Insight {
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  finding: string;
  evidence?: string;
  driver?: string;
  impact?: string;
  decision?: string;
  action?: string;
}

const SEVERITY: Record<string, {
  bar: string; badge: string; glow: string; label: string; dot: string;
}> = {
  critical: {
    bar:   "bg-danger",
    badge: "bg-danger/10 text-danger border border-danger/20",
    glow:  "border-danger/20 bg-danger/5",
    label: "Critical",
    dot:   "bg-danger",
  },
  high: {
    bar:   "bg-caution",
    badge: "bg-caution/10 text-caution border border-caution/20",
    glow:  "border-caution/20 bg-caution/5",
    label: "High",
    dot:   "bg-caution",
  },
  medium: {
    bar:   "bg-azure",
    badge: "bg-azure/10 text-azure border border-azure/20",
    glow:  "border-azure/20 bg-azure/5",
    label: "Medium",
    dot:   "bg-azure",
  },
  low: {
    bar:   "bg-grow",
    badge: "bg-grow/10 text-grow border border-grow/20",
    glow:  "border-grow/20 bg-grow/5",
    label: "Info",
    dot:   "bg-grow",
  },
};

export default function InsightPanel({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;

  const critical = insights.filter((i) => i.severity === "critical" || i.severity === "high");
  const rest = insights.filter((i) => i.severity !== "critical" && i.severity !== "high");

  return (
    <div className="bg-card rounded-xl border border-rim shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-rim flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg bg-signal/10 border border-signal/25 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5">
            <path d="M7 2.5v4.5M7 9.5v.5" stroke="#00B5AD" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="7" cy="7" r="5.5" stroke="#00B5AD" strokeWidth="1.2" strokeOpacity="0.5"/>
          </svg>
        </div>
        <div>
          <h3 className="text-[11px] font-bold text-ink uppercase tracking-[0.12em]">Executive Insights</h3>
          <p className="text-[10px] text-mist mt-0.5 font-mono">{insights.length} finding{insights.length !== 1 ? "s" : ""} · ranked by priority</p>
        </div>
        {critical.length > 0 && (
          <span className="ml-auto rounded-full bg-danger/10 border border-danger/20 text-danger text-[9px] font-bold uppercase tracking-wide px-2.5 py-0.5">
            {critical.length} require action
          </span>
        )}
      </div>

      {/* Insights list */}
      <div className="divide-y divide-rim">
        {[...critical, ...rest].map((ins, i) => {
          const s = SEVERITY[ins.severity] ?? SEVERITY.low;
          return (
            <div key={i} className={`flex gap-0 ${s.glow}`}>
              {/* Left severity bar */}
              <div className={`w-[3px] flex-shrink-0 ${s.bar}`} />

              <div className="flex-1 px-5 py-4 space-y-2.5">
                {/* Badge + headline */}
                <div className="flex items-start gap-2.5 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide flex-shrink-0 mt-0.5 ${s.badge}`}>
                    {s.label}
                  </span>
                  <p className="text-[13px] font-semibold text-ink leading-snug flex-1">{ins.headline}</p>
                </div>

                {/* Finding */}
                <p className="text-[11px] text-dim leading-relaxed">{ins.finding}</p>

                {/* Evidence / Driver inline */}
                {(ins.evidence || ins.driver || ins.impact) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {ins.evidence && (
                      <span className="text-[10px] text-mist">
                        <span className="font-semibold text-dim">Evidence:</span> {ins.evidence}
                      </span>
                    )}
                    {ins.driver && (
                      <span className="text-[10px] text-mist">
                        <span className="font-semibold text-dim">Driver:</span> {ins.driver}
                      </span>
                    )}
                    {ins.impact && (
                      <span className="text-[10px] text-mist">
                        <span className="font-semibold text-dim">Impact:</span> {ins.impact}
                      </span>
                    )}
                  </div>
                )}

                {/* Decision + Action */}
                {(ins.decision || ins.action) && (
                  <div className="border-t border-current/10 pt-2 space-y-1">
                    {ins.decision && (
                      <p className="text-[11px] text-ink font-medium flex items-start gap-1.5">
                        <span className="text-signal flex-shrink-0 mt-0.5">▸</span>
                        <span><span className="font-bold">Decision:</span> {ins.decision}</span>
                      </p>
                    )}
                    {ins.action && (
                      <p className="text-[11px] text-signal font-semibold flex items-start gap-1.5">
                        <span className="flex-shrink-0 mt-0.5">→</span>
                        <span>{ins.action}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
