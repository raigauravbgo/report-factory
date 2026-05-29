"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SectionHeader from "@/components/ui/SectionHeader";

interface ColumnMapping {
  raw_column: string;
  confidence: number;
  needs_review: boolean;
  source_file?: string;
}

interface Report {
  id: string;
  status: string;
  template_type: string | null;
  client_id: string | null;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  intake_spec: Record<string, unknown> | null;
  column_mapping: Record<string, ColumnMapping> | null;
  computed_kpis: Record<string, { value: number | null; flags: string[] }> | null;
  data_quality_flags: string[] | null;
  created_at: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  intake:                            { bg: "bg-gray-100",   text: "text-gray-600",   label: "Intake" },
  awaiting_upload:                   { bg: "bg-blue-100",   text: "text-blue-700",   label: "Awaiting Upload" },
  awaiting_mapping_confirmation:     { bg: "bg-yellow-100", text: "text-yellow-700", label: "Mapping Review" },
  mapping_confirmed:                 { bg: "bg-purple-100", text: "text-purple-700", label: "Computing" },
  computed:                          { bg: "bg-teal-100",   text: "text-teal-700",   label: "Computed" },
  review:                            { bg: "bg-orange-100", text: "text-orange-700", label: "In Review" },
  approved:                          { bg: "bg-green-100",  text: "text-green-700",  label: "Approved" },
  rejected:                          { bg: "bg-red-100",    text: "text-red-700",    label: "Rejected" },
};

export default function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/reports/${reportId}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        setReport(data);
        // Pre-fill overrides with current raw_column values
        if (data.column_mapping) {
          const init: Record<string, string> = {};
          Object.entries(data.column_mapping as Record<string, ColumnMapping>).forEach(([kpi, m]) => {
            init[kpi] = m.raw_column ?? "";
          });
          setOverrides(init);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [reportId]);

  async function confirmMapping() {
    if (!report) return;
    setConfirming(true);
    setError(null);
    try {
      const mapping: Record<string, { numerator_column: string; denominator_column: string }> = {};
      Object.entries(overrides).forEach(([kpi, col]) => {
        mapping[kpi] = { numerator_column: col, denominator_column: col };
      });
      const res = await fetch(`${BASE_URL}/api/reports/${reportId}/confirm-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess("Mapping confirmed. Report is now computing KPIs.");
      // Refresh report status
      const updated = await fetch(`${BASE_URL}/api/reports/${reportId}`).then((r) => r.json());
      setReport(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen gap-3 text-gray-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
      Loading report…
    </div>
  );

  if (error && !report) return (
    <div className="p-8 space-y-4">
      <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">{error}</div>
      <button onClick={() => router.push("/")} className="text-sm text-[#00B5AD] underline">← Back to Library</button>
    </div>
  );

  if (!report) return null;

  const style = STATUS_STYLES[report.status] ?? STATUS_STYLES["intake"];
  const mapping = report.column_mapping ?? {};
  const hasMapping = Object.keys(mapping).length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-[#1B2340]">{report.client_id ?? "Report"}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {report.template_type ?? "—"} · {report.period_start} → {report.period_end}
          </p>
        </div>
        <button onClick={() => router.push("/")} className="text-sm text-gray-500 hover:text-gray-700">
          ← Library
        </button>
      </div>

      <div className="flex-1 p-6 max-w-4xl space-y-8">

        {success && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{success}</div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Mapping Confirmation */}
        {hasMapping && (
          <section className="space-y-3">
            <SectionHeader
              title="Column Mapping"
              subtitle="Review and correct the column mapping before confirming"
            />
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-1/3">KPI</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-1/3">Matched Column</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-1/6">Confidence</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-1/6">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(mapping).map(([kpi, m]) => {
                    const conf = m.confidence ?? 0;
                    const flagged = m.needs_review || conf < 0.7;
                    return (
                      <tr key={kpi} className={`border-b border-gray-50 last:border-0 ${flagged ? "bg-amber-50" : ""}`}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{kpi}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.raw_column ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${
                            conf >= 0.9 ? "text-green-600" :
                            conf >= 0.7 ? "text-blue-600" :
                            "text-red-600"
                          }`}>
                            {flagged && "⚠ "}{(conf * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={overrides[kpi] ?? ""}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [kpi]: e.target.value }))}
                            disabled={report.status !== "awaiting_mapping_confirmation"}
                            placeholder="column name"
                            className={`w-full rounded border px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#00B5AD]
                              ${flagged ? "border-amber-300 bg-amber-50" : "border-gray-200"}
                              disabled:bg-transparent disabled:border-transparent`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {report.status === "awaiting_mapping_confirmation" && (
              <div className="flex items-center gap-3">
                <button
                  onClick={confirmMapping}
                  disabled={confirming}
                  className="rounded-lg bg-[#00B5AD] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#009d96] disabled:opacity-50 transition-colors"
                >
                  {confirming ? "Confirming…" : "✓ Confirm Mapping"}
                </button>
                <p className="text-xs text-gray-400">
                  {Object.values(mapping).filter((m) => m.needs_review || m.confidence < 0.7).length} items need review
                </p>
              </div>
            )}
          </section>
        )}

        {/* Computed KPIs */}
        {report.computed_kpis && Object.keys(report.computed_kpis).length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Computed KPIs" />
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(report.computed_kpis).map(([kpi, result]) => (
                <div key={kpi} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold truncate">{kpi}</p>
                  <p className="text-2xl font-bold text-[#1B2340] mt-1">
                    {result.value !== null ? result.value : "—"}
                  </p>
                  {result.flags?.length > 0 && (
                    <p className="text-xs text-amber-600 mt-1">⚠ {result.flags[0]}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Data quality flags */}
        {report.data_quality_flags && report.data_quality_flags.length > 0 && (
          <section className="space-y-2">
            <SectionHeader title="Data Quality Flags" />
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 space-y-1">
              {report.data_quality_flags.map((flag, i) => (
                <p key={i} className="text-xs text-amber-700">⚠ {flag}</p>
              ))}
            </div>
          </section>
        )}

        {/* Intake spec */}
        {report.intake_spec && (
          <section className="space-y-2">
            <SectionHeader title="Intake Specification" />
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <pre className="text-xs text-gray-600 overflow-auto">{JSON.stringify(report.intake_spec, null, 2)}</pre>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
