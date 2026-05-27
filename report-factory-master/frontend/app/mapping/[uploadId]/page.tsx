"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MappingTable from "@/components/MappingTable";
import StepIndicator from "@/components/ui/StepIndicator";
import SectionHeader from "@/components/ui/SectionHeader";
import { api } from "@/lib/api";
import type { MappingEntry } from "@/lib/types";

const DarkSidebar = dynamic(() => import("@/components/layout/DarkSidebar"), { ssr: false });

export default function MappingPage() {
  const { uploadId } = useParams<{ uploadId: string }>();
  const router = useRouter();
  const id = Number(uploadId);

  const [mapping, setMapping] = useState<Record<string, MappingEntry>>({});
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMapping(id)
      .then((res) => { setMapping(res.mapping); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [id]);

  async function handleConfirm() {
    setConfirming(true);
    setError("");
    try {
      const res = await api.confirmMapping(id, mapping);
      router.push(`/kpis?uploadId=${id}&recipeId=${res.recipe_id}`);
    } catch (e) {
      setError(String(e));
      setConfirming(false);
    }
  }

  // Mapping stats
  const totalCols = Object.keys(mapping).length;
  const autoCols = Object.values(mapping).filter((e) => e.status === "auto").length;
  const reviewCols = Object.values(mapping).filter((e) => e.status === "review_needed").length;
  const manualCols = Object.values(mapping).filter((e) => e.status === "manual").length;
  const ignoredCols = Object.values(mapping).filter((e) => e.status === "ignored").length;

  return (
    <div className="flex h-screen overflow-hidden">
      <DarkSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Column Mapping</h1>
            <p className="text-xs text-gray-400">Upload #{id} · Review AI-inferred mappings before running KPI analysis</p>
          </div>
          <StepIndicator current={3} />
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#F4F6FA] px-6 py-5">

          {loading ? (
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
              <span className="text-sm text-gray-500">Loading column mapping…</span>
            </div>
          ) : (
            <>
              {/* Stats row */}
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Total Columns", value: totalCols, color: "text-gray-800", bg: "bg-white" },
                  { label: "Auto-mapped", value: autoCols, color: "text-emerald-700", bg: "bg-emerald-50" },
                  { label: "Need Review", value: reviewCols, color: "text-amber-700", bg: "bg-amber-50" },
                  { label: "Ignored", value: ignoredCols, color: "text-gray-400", bg: "bg-white" },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border border-gray-100 ${s.bg} px-4 py-3 shadow-sm`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</p>
                    <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Review warning */}
              {reviewCols > 0 && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-amber-700">
                    <span className="font-semibold">{reviewCols} column{reviewCols > 1 ? "s" : ""} need your review.</span>{" "}
                    Low-confidence mappings are highlighted in yellow. Edit the canonical name or set status to <em>ignored</em> if not needed.
                  </p>
                </div>
              )}

              {/* Mapping table */}
              <div className="mb-5 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-gray-50 px-5 py-3.5">
                  <SectionHeader
                    title="Column Mappings"
                    subtitle={`${totalCols} columns · ${autoCols} auto · ${reviewCols} review · ${manualCols} manual`}
                  />
                </div>
                <div className="p-1">
                  <MappingTable mapping={mapping} onChange={setMapping} />
                </div>
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="font-semibold">Error: </span>{error}
                </div>
              )}

              {/* Action bar */}
              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                <button
                  onClick={() => router.push(`/profile/${id}`)}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Profile
                </button>

                <div className="flex items-center gap-3">
                  {reviewCols > 0 && (
                    <p className="text-xs text-amber-600 font-medium">
                      {reviewCols} uncertain mapping{reviewCols > 1 ? "s" : ""} remaining
                    </p>
                  )}
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="flex items-center gap-2 rounded-lg bg-[#00B5AD] px-5 py-2 text-sm font-semibold text-white hover:bg-[#009A93] disabled:opacity-50"
                  >
                    {confirming ? (
                      <>
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Confirming…
                      </>
                    ) : (
                      <>
                        Confirm & Continue
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
