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
  intake:                             { bg: "bg-wash",          text: "text-dim",    label: "Intake" },
  awaiting_upload:                    { bg: "bg-azure/10",      text: "text-azure",  label: "Awaiting Upload" },
  awaiting_mapping_confirmation:      { bg: "bg-caution/10",    text: "text-caution", label: "Mapping Review" },
  mapping_confirmed:                  { bg: "bg-royal/10",      text: "text-royal",  label: "Computing" },
  computed:                           { bg: "bg-signal/10",     text: "text-signal", label: "Computed" },
  review:                             { bg: "bg-caution/10",    text: "text-caution", label: "In Review" },
  approved:                           { bg: "bg-grow/10",       text: "text-grow",   label: "Approved" },
  rejected:                           { bg: "bg-danger/10",     text: "text-danger", label: "Rejected" },
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
      <div className="bg-card border-b border-rim px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-bold text-ink tracking-tight">Report Library</h1>
          <p className="text-[11px] text-mist mt-0.5">All reports — click to continue or review</p>
        </div>
        <button
          onClick={() => router.push("/upload")}
          className="rounded-lg bg-signal text-white px-5 py-2.5 text-[12px] font-semibold hover:bg-signal/90 transition-colors shadow-sm"
        >
          + New Report
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-rim px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3 text-mist">
            <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-[10px] font-bold text-mist uppercase tracking-[0.1em]">Filter</span>
        </div>
        <select
          value={filterTemplate}
          onChange={(e) => setFilterTemplate(e.target.value)}
          className="rounded-lg border border-rim bg-raised text-[11px] px-3 py-1.5 text-dim focus:outline-none focus:border-signal hover:border-edge transition-colors"
        >
          <option value="">All templates</option>
          {Object.entries(TEMPLATE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-rim bg-raised text-[11px] px-3 py-1.5 text-dim focus:outline-none focus:border-signal hover:border-edge transition-colors"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="text-[10px] text-mist font-mono ml-auto">
          {filtered.length} report{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 p-6">
        {loading && (
          <div className="flex items-center gap-3 text-dim text-[12px] py-12 justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal border-t-transparent" />
            Loading reports…
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-danger/5 border border-danger/25 px-5 py-4 text-[12px] text-danger flex items-start gap-2">
            <span>⚠</span> {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-16 h-16 rounded-2xl bg-card border-2 border-rim flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-mist">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-ink font-semibold text-[14px]">No reports yet</p>
              <p className="text-mist text-[12px] mt-1">Upload data files to create your first dashboard</p>
            </div>
            <button
              onClick={() => router.push("/upload")}
              className="rounded-lg bg-signal text-white px-5 py-2.5 text-[12px] font-semibold hover:bg-signal/90 transition-colors shadow-sm"
            >
              Create your first report
            </button>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-5">
            <SectionHeader title={`${filtered.length} Report${filtered.length !== 1 ? "s" : ""}`} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((report) => {
                const style = STATUS_STYLES[report.status] ?? STATUS_STYLES["intake"];
                const template = TEMPLATE_LABELS[report.template_type ?? ""] ?? report.template_type ?? "—";
                const date = new Date(report.created_at).toLocaleDateString();
                return (
                  <div
                    key={report.id}
                    onClick={() => router.push(`/reports/${report.id}`)}
                    className="bg-card rounded-xl border border-rim p-5 cursor-pointer hover:border-signal/30 hover:bg-raised/60 transition-all duration-200 space-y-3.5 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] border ${style.bg} ${style.text} border-current/20`}>
                        {style.label}
                      </span>
                      <span className="text-[10px] text-mist font-mono">{date}</span>
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-ink truncate">{report.client_id ?? "—"}</p>
                      <p className="text-[11px] text-dim mt-0.5">{template}</p>
                    </div>
                    {(report.period_start || report.period_end) && (
                      <p className="text-[10px] text-mist font-mono">
                        {report.period_start} → {report.period_end}
                      </p>
                    )}
                    <div className="pt-2.5 border-t border-rim flex items-center justify-between">
                      <span className="text-[9px] text-mist font-mono truncate">{report.id.slice(0, 8)}…</span>
                      <span className="text-[10px] text-signal font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        Open →
                      </span>
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
