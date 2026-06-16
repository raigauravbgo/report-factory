"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { KpiContribution, KpiContributeResponse, CustomKpiForRegistry, KpiFormat } from "@/lib/types";

interface PageProps { params: Promise<{ recipeId: string }> }

const DOMAINS = [
  { value: "collections", label: "Collections" },
  { value: "cx",          label: "Customer Experience" },
  { value: "workforce",   label: "Workforce" },
  { value: "sales",       label: "Sales" },
  { value: "ops",         label: "Operations" },
];

const FORMATS: { value: KpiFormat; label: string }[] = [
  { value: "number",     label: "Number" },
  { value: "percentage", label: "Percentage (%)" },
  { value: "currency",   label: "Currency ($)" },
];

interface KpiDraft extends CustomKpiForRegistry {
  selected: boolean;
  domain: string;
  format: KpiFormat;
  description: string;
}

function initDrafts(raw: CustomKpiForRegistry[]): KpiDraft[] {
  return raw.map((k) => ({
    ...k,
    selected: true,
    domain: "ops",
    format: "number",
    description: "",
  }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ recipeId, onBack }: { recipeId: string; onBack: () => void }) {
  return (
    <div className="mb-8">
      <button
        onClick={onBack}
        className="mb-5 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors"
      >
        ← Back to Dashboard
      </button>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white text-xl shadow-sm">
          📤
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">
            Contribute KPIs to Shared Registry
          </h1>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed max-w-xl">
            Your custom KPIs were validated in the dashboard. Add them to the shared registry so
            your team can reuse them in future reports — they&apos;ll be flagged for data team
            review before becoming official.
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
      <span className="mt-0.5 text-blue-500 shrink-0">ℹ</span>
      <p className="text-xs text-blue-700 leading-relaxed">
        Registered KPIs are added with <strong>pending review</strong> status. The central data
        team will validate each one before it becomes available to all users. This step is
        completely optional.
      </p>
    </div>
  );
}

function KpiCard({
  draft,
  index,
  onChange,
}: {
  draft: KpiDraft;
  index: number;
  onChange: (index: number, patch: Partial<KpiDraft>) => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-opacity ${
        draft.selected ? "border-slate-200 opacity-100" : "border-slate-100 opacity-50"
      }`}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
        <input
          type="checkbox"
          checked={draft.selected}
          onChange={(e) => onChange(index, { selected: e.target.checked })}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 accent-blue-600"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-tight">{draft.name}</p>
          <code className="mt-1 inline-block max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-600">
            {draft.formula}
          </code>
        </div>
      </div>

      {/* Card fields — only interactive when selected */}
      <div className={`px-5 py-4 grid grid-cols-2 gap-4 ${!draft.selected ? "pointer-events-none" : ""}`}>
        {/* Domain */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Domain
          </label>
          <select
            value={draft.domain}
            onChange={(e) => onChange(index, { domain: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Format */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Format
          </label>
          <select
            value={draft.format}
            onChange={(e) => onChange(index, { format: e.target.value as KpiFormat })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Description <span className="normal-case font-normal text-slate-300">(optional)</span>
          </label>
          <textarea
            value={draft.description}
            onChange={(e) => onChange(index, { description: e.target.value })}
            placeholder="What does this KPI measure and why is it useful?"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>
    </div>
  );
}

function SuccessPanel({
  result,
  onDashboard,
}: {
  result: KpiContributeResponse;
  onDashboard: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
        ✓
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">
        {result.registered_count === 1
          ? "1 KPI registered!"
          : `${result.registered_count} KPIs registered!`}
      </h2>
      <p className="text-sm text-slate-500 mb-6 leading-relaxed">
        Your KPIs have been submitted for data team review. Once approved, they&apos;ll appear in
        the shared registry for everyone to use.
      </p>

      {/* Registered list */}
      {result.registered.length > 0 && (
        <div className="mb-4 text-left rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          {result.registered.map((k) => (
            <div key={k.kpi_id} className="flex items-center gap-2 py-1">
              <span className="text-emerald-600 text-sm">✓</span>
              <span className="text-xs font-semibold text-emerald-800">{k.display_name}</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 capitalize">
                {k.domain}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Skipped list */}
      {result.skipped.length > 0 && (
        <div className="mb-6 text-left rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">
            Skipped
          </p>
          {result.skipped.map((k, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="text-amber-500 text-sm">⚠</span>
              <span className="text-xs text-amber-800">
                {k.name} — {k.reason}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onDashboard}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
      >
        ← Back to Dashboard
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KpiRegistryPage({ params }: PageProps) {
  const { recipeId } = use(params);
  const router = useRouter();

  const [drafts, setDrafts]       = useState<KpiDraft[]>([]);
  const [loading, setLoading]     = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<KpiContributeResponse | null>(null);

  useEffect(() => {
    api.getCustomKpisFromRecipe(Number(recipeId))
      .then((r) => setDrafts(initDrafts(r.custom_kpis)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [recipeId]);

  function updateDraft(index: number, patch: Partial<KpiDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleRegister() {
    const selected = drafts.filter((d) => d.selected);
    if (!selected.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const contributions = selected.map((d) => ({
        name: d.name,
        formula: d.formula,
        domain: d.domain,
        format: d.format,
        description: d.description,
      }));
      const res = await api.contributeKpisToRegistry(Number(recipeId), contributions);
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const toDashboard = () => router.push(`/dashboard/${recipeId}`);
  const selectedCount = drafts.filter((d) => d.selected).length;

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-slate-50">
        <div className="text-center">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-xs text-slate-400">Loading KPI registry…</p>
        </div>
      </main>
    );
  }

  // ── Success state ────────────────────────────────────────────────────────

  if (result) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8 bg-slate-50 min-h-screen">
        <SuccessPanel result={result} onDashboard={toDashboard} />
      </main>
    );
  }

  // ── No custom KPIs ───────────────────────────────────────────────────────

  if (!loading && drafts.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8 bg-slate-50 min-h-screen">
        <button
          onClick={toDashboard}
          className="mb-5 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors"
        >
          ← Back to Dashboard
        </button>
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-4 text-4xl">📋</div>
          <p className="text-sm font-semibold text-slate-700 mb-1">No custom KPIs to contribute</p>
          <p className="text-xs text-slate-400 mb-6">
            This dashboard uses only catalog KPIs. Custom KPIs you define in future reports can be
            contributed here.
          </p>
          <button
            onClick={toDashboard}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 bg-slate-50 min-h-screen">
      <PageHeader recipeId={recipeId} onBack={toDashboard} />
      <InfoBanner />

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="space-y-4 mb-8">
        {drafts.map((draft, i) => (
          <KpiCard key={draft.name} draft={draft} index={i} onChange={updateDraft} />
        ))}
      </div>

      {/* Selection summary */}
      <div className="mb-6 flex items-center gap-2 text-xs text-slate-400">
        <span
          className={`font-semibold ${selectedCount > 0 ? "text-slate-700" : "text-slate-400"}`}
        >
          {selectedCount} of {drafts.length} KPI{drafts.length !== 1 ? "s" : ""} selected
        </span>
        {drafts.length > 1 && (
          <>
            <span>·</span>
            <button
              onClick={() =>
                setDrafts((prev) =>
                  prev.map((d) => ({ ...d, selected: selectedCount < drafts.length })),
                )
              }
              className="text-blue-500 hover:underline"
            >
              {selectedCount < drafts.length ? "Select all" : "Deselect all"}
            </button>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleRegister}
          disabled={selectedCount === 0 || submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Registering…
            </>
          ) : (
            <>
              Register {selectedCount > 0 ? `${selectedCount} ` : ""}KPI{selectedCount !== 1 ? "s" : ""} →
            </>
          )}
        </button>

        <button
          onClick={toDashboard}
          className="text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors"
        >
          Skip, use only locally
        </button>
      </div>
    </main>
  );
}
