import type { KpiResult } from "@/lib/types";

interface Insight {
  headline: string;
  findings: { metric: string; value: string }[];
  dataQuality: string;
  decision: string;
  action: string;
  severity: "critical" | "high" | "medium" | "low";
}

function formatValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  let formatted: string;
  if (abs >= 1_000_000) formatted = `${(value / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) formatted = `${(value / 1_000).toFixed(1)}K`;
  else if (abs < 10) formatted = value.toFixed(2);
  else formatted = value.toLocaleString();
  return unit ? `${formatted} ${unit}` : formatted;
}

function buildInsight(kpis: KpiResult[]): Insight {
  const successful = kpis.filter((r) => !r.error && r.value !== null && r.value !== undefined);
  const failed = kpis.filter((r) => !!r.error);

  const revKpi = successful.find((r) =>
    /revenue|sales|gross|income/i.test(r.name)
  );
  const headlineKpi = revKpi ?? successful[0];

  const severity: Insight["severity"] =
    failed.length > successful.length / 2
      ? "high"
      : failed.length > 0
      ? "medium"
      : "low";

  const headline = headlineKpi
    ? `${headlineKpi.name} stands at ${formatValue(headlineKpi.value, headlineKpi.unit)} for the current period.`
    : `Analysis complete — ${successful.length} KPI${successful.length !== 1 ? "s" : ""} computed.`;

  const findings = successful.slice(0, 5).map((r) => ({
    metric: r.name,
    value: formatValue(r.value, r.unit),
  }));

  const dataQuality =
    failed.length === 0
      ? `All ${successful.length} KPIs computed successfully with no data quality issues.`
      : `${failed.length} KPI${failed.length !== 1 ? "s" : ""} could not be computed — likely missing required columns. ${successful.length} KPIs are available for review.`;

  const decision =
    successful.length > 0
      ? `Review the ${successful.length} computed KPIs against your targets. Prioritise any metrics outside expected ranges before the next reporting cycle.`
      : "No KPI data available — check column mapping and re-run analysis.";

  const action =
    "Export the PowerPoint report and share with stakeholders. Set up weekly monitoring for key metrics flagged below.";

  return { headline, findings, dataQuality, decision, action, severity };
}

const SEVERITY_STYLE = {
  critical: { bar: "bg-red-500", badge: "bg-red-100 text-red-700", label: "Critical" },
  high: { bar: "bg-amber-400", badge: "bg-amber-100 text-amber-700", label: "Needs Attention" },
  medium: { bar: "bg-blue-400", badge: "bg-blue-100 text-blue-700", label: "Review" },
  low: { bar: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700", label: "On Track" },
};

interface Props {
  kpis: KpiResult[];
}

export default function InsightPanel({ kpis }: Props) {
  const insight = buildInsight(kpis);
  const style = SEVERITY_STYLE[insight.severity];

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Severity bar */}
      <div className={`h-1 w-full ${style.bar}`} />

      <div className="p-5">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* Lightbulb icon */}
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#00B5AD]/10">
              <svg className="h-4 w-4 text-[#00B5AD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.355a3.375 3.375 0 01-3 0m3-9.878V8.25a4.5 4.5 0 00-9 0v2.122m9 0a3 3 0 11-6 0m6 0H9" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Executive Summary</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-900">{insight.headline}</p>
            </div>
          </div>
          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
            {style.label}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* What happened */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              What happened
            </p>
            <ul className="space-y-1">
              {insight.findings.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-gray-600">{f.metric}</span>
                  <span className="flex-shrink-0 font-mono text-xs font-semibold text-gray-900">{f.value}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-gray-400">{insight.dataQuality}</p>
          </div>

          {/* Decision needed */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Decision needed
            </p>
            <p className="text-xs leading-relaxed text-gray-700">{insight.decision}</p>
          </div>

          {/* Recommended action */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Recommended action
            </p>
            <p className="text-xs leading-relaxed text-gray-700">{insight.action}</p>
            <div className="mt-3 flex items-center gap-1 text-[11px] text-[#00B5AD]">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <span className="font-medium">Monitor follow-up KPIs weekly</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
