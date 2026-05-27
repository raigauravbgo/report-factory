import type { KpiResult } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  let formatted: string;
  if (abs >= 1_000_000) formatted = `${(value / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) formatted = `${(value / 1_000).toFixed(1)}K`;
  else if (abs < 10 && abs > 0) formatted = value.toFixed(2);
  else formatted = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return unit ? `${formatted} ${unit}` : formatted;
}

interface KpiMeta { color: string; bg: string; icon: React.ReactNode }

function getKpiMeta(name: string): KpiMeta {
  const key = name.toLowerCase();

  const DollarIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  const PercentIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M9 14.25l6-6m4.5-3.493V21.75l-4.125-2.625-4.125 2.625-4.125-2.625L3 21.75V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z" />
    </svg>
  );
  const ChartIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm6.75-9.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v16.5c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 019.75 19.875V3.375zm6.75 5.25c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
    </svg>
  );
  const ClockIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  const PeopleIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
  const WarningIcon = (
    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );

  if (/revenue|sales|income|gross|net profit|margin.*\$/.test(key))
    return { color: "#6366F1", bg: "#EEF2FF", icon: DollarIcon };
  if (/margin|rate|pct|percent|ratio|csat|score|nps/.test(key))
    return { color: "#10B981", bg: "#ECFDF5", icon: PercentIcon };
  if (/time|duration|days|hours|aht|handle/.test(key))
    return { color: "#8B5CF6", bg: "#F5F3FF", icon: ClockIcon };
  if (/headcount|staff|agent|employee|workforce|count/.test(key))
    return { color: "#6366F1", bg: "#EEF2FF", icon: PeopleIcon };
  if (/attrition|churn|abandon|turnover|fail/.test(key))
    return { color: "#EF4444", bg: "#FEF2F2", icon: WarningIcon };
  if (/discount|cost|spend|expense/.test(key))
    return { color: "#F59E0B", bg: "#FFFBEB", icon: DollarIcon };
  return { color: "#00B5AD", bg: "#F0FDFB", icon: ChartIcon };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  result: KpiResult;
}

export default function KpiCard({ result }: Props) {
  const meta = getKpiMeta(result.name);
  const display = formatValue(result.value, result.unit);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Subtle teal top accent on hover */}
      <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-transparent via-[#00B5AD]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 truncate text-xs font-semibold uppercase tracking-wide text-gray-400">
            {result.name}
          </p>
          <p className="text-[11px] text-gray-300">Current period</p>
        </div>
        {/* Colored icon circle */}
        <div
          className="ml-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: meta.bg }}
        >
          <div style={{ color: meta.color }}>{meta.icon}</div>
        </div>
      </div>

      <div className="mt-3">
        {result.error ? (
          <p className="text-sm text-red-500">{result.error}</p>
        ) : (
          <p
            className="text-2xl font-bold tracking-tight"
            style={{ color: meta.color }}
          >
            {display}
          </p>
        )}
      </div>

      {/* Bottom domain tag */}
      <div className="mt-3 flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
        <span className="text-[10px] font-medium text-gray-300 uppercase tracking-wide">
          {result.kpi_id?.split("_")[0] ?? "metric"}
        </span>
      </div>
    </div>
  );
}
