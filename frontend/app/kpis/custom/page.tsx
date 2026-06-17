"use client";

import { useEffect, useState } from "react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Status = "pending" | "approved" | "rejected" | "all";

interface Proposal {
  id: number;
  kpi_id: string;
  display_name: string;
  formula: string;
  description: string;
  domain: string;
  aggregation: string;
  format: string;
  status: string;
  dataset_id: number | null;
  recipe_id: number | null;
  created_at: string | null;
}

const STATUS_TABS: { label: string; value: Status }[] = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

const FORMAT_LABELS: Record<string, string> = {
  percentage: "Percentage",
  integer: "Integer",
  currency: "Currency",
  duration: "Duration",
  decimal: "Decimal",
};

const AGG_LABELS: Record<string, string> = {
  sum: "Sum",
  average: "Average",
  ratio_of_sums: "Ratio of Sums",
};

export default function CustomKpiPage() {
  const [tab, setTab] = useState<Status>("pending");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approval modal state
  const [approving, setApproving] = useState<Proposal | null>(null);
  const [editFormula, setEditFormula] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchProposals(status: Status) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/kpis/custom?status=${status}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      setProposals(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProposals(tab);
  }, [tab]);

  function openApprove(p: Proposal) {
    setApproving(p);
    setEditFormula(p.formula);
    setEditDescription(p.description);
  }

  async function confirmApprove() {
    if (!approving) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/kpis/custom/${approving.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formula: editFormula, description: editDescription }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || `API ${res.status}`);
      }
      setApproving(null);
      fetchProposals(tab);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: number) {
    if (!confirm("Reject this custom KPI?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/kpis/custom/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      fetchProposals(tab);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  }

  const pending = proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="min-h-screen bg-[#0F1629] text-white px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Custom KPI Approvals</h1>
        <p className="text-[#94A3B8] text-sm">
          AI-generated KPIs from your sessions. Approve to add them to the catalog — they will be
          suggested automatically in future sessions with similar data.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#1B2340] p-1 rounded-lg w-fit">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-[#2D3F6B] text-white"
                : "text-[#94A3B8] hover:text-white"
            }`}
          >
            {t.label}
            {t.value === "pending" && pending > 0 && (
              <span className="ml-2 bg-amber-500 text-black text-[11px] font-bold px-1.5 py-0.5 rounded-full">
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="text-[#94A3B8] text-sm">Loading proposals...</div>
      )}

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">
          {error}
        </div>
      )}

      {!loading && !error && proposals.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-sm">
            {tab === "pending"
              ? "No custom KPIs pending approval. Run a session with AI-generated KPIs to see them here."
              : `No ${tab} custom KPIs.`}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {proposals.map((p) => (
          <div
            key={p.id}
            className="bg-[#1B2340] border border-white/10 rounded-xl p-5 flex gap-4 items-start"
          >
            {/* Left — info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-semibold text-[15px]">{p.display_name}</span>
                <span className="text-[#94A3B8] text-xs font-mono bg-white/5 px-2 py-0.5 rounded">
                  {p.kpi_id}
                </span>
                {p.status === "approved" && (
                  <span className="text-emerald-400 text-[11px] font-semibold bg-emerald-400/10 px-2 py-0.5 rounded-full">
                    ✓ In catalog
                  </span>
                )}
                {p.status === "rejected" && (
                  <span className="text-red-400 text-[11px] font-semibold bg-red-400/10 px-2 py-0.5 rounded-full">
                    Rejected
                  </span>
                )}
              </div>

              <code className="block text-[#00B5AD] text-sm font-mono bg-black/30 px-3 py-1.5 rounded mt-1 mb-2 truncate">
                {p.formula}
              </code>

              {p.description && (
                <p className="text-[#94A3B8] text-xs mb-2">{p.description}</p>
              )}

              <div className="flex gap-3 text-xs text-[#64748B]">
                {p.domain && <span>Domain: <span className="text-[#94A3B8]">{p.domain}</span></span>}
                {p.format && <span>Format: <span className="text-[#94A3B8]">{FORMAT_LABELS[p.format] ?? p.format}</span></span>}
                {p.aggregation && <span>Agg: <span className="text-[#94A3B8]">{AGG_LABELS[p.aggregation] ?? p.aggregation}</span></span>}
                {p.recipe_id && (
                  <span>
                    Recipe:{" "}
                    <a
                      href={`/dashboard/${p.recipe_id}`}
                      className="text-[#00B5AD] hover:underline"
                    >
                      #{p.recipe_id}
                    </a>
                  </span>
                )}
                {p.created_at && (
                  <span>{new Date(p.created_at).toLocaleDateString()}</span>
                )}
              </div>
            </div>

            {/* Right — actions */}
            {p.status === "pending" && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => openApprove(p)}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject(p.id)}
                  className="px-4 py-1.5 bg-white/5 hover:bg-red-900/30 text-[#94A3B8] hover:text-red-400 text-sm font-medium rounded-lg transition-colors"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Approval modal */}
      {approving && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1B2340] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h2 className="text-white font-semibold text-lg mb-1">
              Approve: {approving.display_name}
            </h2>
            <p className="text-[#94A3B8] text-sm mb-5">
              Edit the formula if needed to generalise column names before saving to the catalog.
            </p>

            <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Formula</label>
            <input
              type="text"
              value={editFormula}
              onChange={(e) => setEditFormula(e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-[#00B5AD] font-mono focus:outline-none focus:border-[#00B5AD]/50 mb-4"
              placeholder="e.g. COUNT(rubric_id)"
            />

            <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
              Description <span className="font-normal opacity-60">(optional)</span>
            </label>
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00B5AD]/50 mb-6"
              placeholder="What does this KPI measure?"
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setApproving(null)}
                className="px-4 py-2 text-sm text-[#94A3B8] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmApprove}
                disabled={saving || !editFormula.trim()}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? "Saving…" : "Confirm & Save to Catalog"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
