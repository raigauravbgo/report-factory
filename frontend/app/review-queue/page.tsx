"use client";

import { useEffect, useState } from "react";
import SectionHeader from "@/components/ui/SectionHeader";

interface QueueEntry {
  id: string;
  request_id: string;
  status: string;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  template_type: string | null;
  client_id: string | null;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  computed_kpis: Record<string, { value: number | null; flags: string[] }> | null;
  data_quality_flags: string[] | null;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TEMPLATE_LABELS: Record<string, string> = {
  client_health_dashboard: "Client Health",
  wbr_qbr: "WBR / QBR",
  exec_scorecard: "Executive Scorecard",
  kpi_spotlight: "KPI Spotlight",
};

export default function ReviewQueuePage() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<QueueEntry | null>(null);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function fetchQueue(status: string) {
    setLoading(true);
    fetch(`${BASE_URL}/api/reports/review-queue/list?status=${status}`)
      .then((r) => r.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchQueue(filterStatus); }, [filterStatus]);

  async function handleAction(action: "approve" | "reject") {
    if (!selected) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/api/reports/review-queue/${selected.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewer_notes: notes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage({ type: "success", text: `Report ${action === "approve" ? "approved" : "rejected"} successfully.` });
      setSelected(null);
      setNotes("");
      fetchQueue(filterStatus);
    } catch (e) {
      setMessage({ type: "error", text: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1B2340]">Review Queue</h1>
          <p className="text-xs text-gray-400 mt-0.5">Central data team review — approve, reject, or override</p>
        </div>
        <div className="flex gap-2">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                filterStatus === s
                  ? "bg-[#1B2340] text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className={`mx-6 mt-4 rounded-lg px-4 py-3 text-sm border ${
          message.type === "success"
            ? "bg-green-50 border-green-200 text-green-700"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* List panel */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-gray-400 text-sm">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-sm text-gray-400 text-center">No {filterStatus} items.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => { setSelected(entry); setNotes(""); setMessage(null); }}
                  className={`w-full text-left px-4 py-4 hover:bg-gray-50 transition-colors ${
                    selected?.id === entry.id ? "bg-blue-50 border-l-4 border-[#00B5AD]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-900 truncate">
                      {entry.client_id ?? "—"}
                    </span>
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${
                      entry.status === "pending" ? "bg-orange-100 text-orange-700" :
                      entry.status === "approved" ? "bg-green-100 text-green-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {entry.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {TEMPLATE_LABELS[entry.template_type ?? ""] ?? entry.template_type ?? "—"}
                  </p>
                  {entry.period_start && (
                    <p className="text-[10px] text-gray-300 font-mono mt-1">
                      {entry.period_start} → {entry.period_end}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <span className="text-4xl">✓</span>
              <p className="text-sm">Select an item to review</p>
            </div>
          ) : (
            <div className="max-w-3xl space-y-6">
              <SectionHeader
                title={`${TEMPLATE_LABELS[selected.template_type ?? ""] ?? selected.template_type ?? "Report"} — ${selected.client_id ?? "—"}`}
                subtitle={`${selected.period_start ?? "—"} → ${selected.period_end ?? "—"} · Created by ${selected.created_by ?? "dev"}`}
              />

              {/* Computed KPIs */}
              {selected.computed_kpis && Object.keys(selected.computed_kpis).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Computed KPIs</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">KPI</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Value</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selected.computed_kpis).map(([kpi, result]) => (
                        <tr key={kpi} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2 font-mono text-xs text-gray-700">{kpi}</td>
                          <td className="px-4 py-2 font-semibold text-gray-900">
                            {result.value !== null ? result.value : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {result.flags?.length > 0 ? (
                              <span className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-0.5">
                                ⚠ {result.flags.join(", ")}
                              </span>
                            ) : (
                              <span className="text-xs text-green-600">✓ OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Data quality flags */}
              {selected.data_quality_flags && selected.data_quality_flags.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Data Quality Flags</p>
                  <ul className="space-y-1">
                    {selected.data_quality_flags.map((flag, i) => (
                      <li key={i} className="text-xs text-amber-600">⚠ {flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reviewer notes */}
              {selected.status === "pending" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    Reviewer Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes for the requester…"
                    className="w-full rounded-lg border border-gray-300 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                  />
                </div>
              )}

              {selected.reviewer_notes && (
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1">Reviewer Notes</p>
                  <p className="text-sm text-gray-700">{selected.reviewer_notes}</p>
                </div>
              )}

              {/* Actions */}
              {selected.status === "pending" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleAction("approve")}
                    disabled={submitting}
                    className="rounded-lg bg-[#00B5AD] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#009d96] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "Saving…" : "✓ Approve"}
                  </button>
                  <button
                    onClick={() => handleAction("reject")}
                    disabled={submitting}
                    className="rounded-lg bg-red-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
