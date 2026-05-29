"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SectionHeader from "@/components/ui/SectionHeader";

interface Report {
  id: string;
  created_by: string;
  template_type: string | null;
  client_id: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  created_at: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  intake:                { bg: "bg-gray-100",   text: "text-gray-600",   label: "Intake" },
  awaiting_upload:       { bg: "bg-blue-100",   text: "text-blue-700",   label: "Awaiting Upload" },
  awaiting_mapping_confirmation: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Mapping Review" },
  mapping_confirmed:     { bg: "bg-purple-100", text: "text-purple-700", label: "Computing" },
  computed:              { bg: "bg-teal-100",   text: "text-teal-700",   label: "Computed" },
  review:                { bg: "bg-orange-100", text: "text-orange-700", label: "In Review" },
  approved:              { bg: "bg-green-100",  text: "text-green-700",  label: "Approved" },
  rejected:              { bg: "bg-red-100",    text: "text-red-700",    label: "Rejected" },
};

const TEMPLATE_LABELS: Record<string, string> = {
  client_health_dashboard: "Client Health",
  wbr_qbr:                 "WBR / QBR",
  exec_scorecard:          "Executive Scorecard",
  kpi_spotlight:           "KPI Spotlight",
};

export default function LibraryPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTemplate, setFilterTemplate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    fetch(`${BASE_URL}/api/reports/`)
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = reports.filter((r) => {
    if (filterTemplate && r.template_type !== filterTemplate) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1B2340]">Report Library</h1>
          <p className="text-xs text-gray-400 mt-0.5">All reports — click to continue or review</p>
        </div>
        <button
          onClick={() => router.push("/upload")}
          className="rounded-lg bg-[#1B2340] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#243057] transition-colors"
        >
          + New Report
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Filter</span>
        <select
          value={filterTemplate}
          onChange={(e) => setFilterTemplate(e.target.value)}
          className="rounded-lg border border-gray-300 text-xs px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
        >
          <option value="">All templates</option>
          {Object.entries(TEMPLATE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 text-xs px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} report{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="flex-1 p-6">
        {loading && (
          <div className="flex items-center gap-3 text-gray-500 py-12 justify-center">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
            Loading reports…
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="text-5xl text-gray-200">▦</div>
            <p className="text-gray-500 text-sm">No reports yet.</p>
            <button
              onClick={() => router.push("/upload")}
              className="rounded-lg bg-[#1B2340] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#243057]"
            >
              Create your first report
            </button>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-4">
            <SectionHeader title={`${filtered.length} Report${filtered.length !== 1 ? "s" : ""}`} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((report) => {
                const style = STATUS_STYLES[report.status] ?? STATUS_STYLES["intake"];
                const template = TEMPLATE_LABELS[report.template_type ?? ""] ?? report.template_type ?? "—";
                const date = new Date(report.created_at).toLocaleDateString();
                return (
                  <div
                    key={report.id}
                    onClick={() => router.push(`/reports/${report.id}`)}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:border-[#00B5AD] hover:shadow-md transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-[10px] text-gray-400">{date}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {report.client_id ?? "—"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{template}</p>
                    </div>
                    {(report.period_start || report.period_end) && (
                      <p className="text-xs text-gray-400 font-mono">
                        {report.period_start} → {report.period_end}
                      </p>
                    )}
                    <div className="pt-1 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 font-mono truncate">{report.id.slice(0, 8)}…</span>
                      <span className="text-[10px] text-[#00B5AD] font-medium">Open →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
