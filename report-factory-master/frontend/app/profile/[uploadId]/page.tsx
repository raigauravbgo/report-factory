"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ColumnTable from "@/components/ColumnTable";
import StepIndicator from "@/components/ui/StepIndicator";
import SectionHeader from "@/components/ui/SectionHeader";
import { api } from "@/lib/api";
import type { ColumnRole, ProfilingResult } from "@/lib/types";

const DarkSidebar = dynamic(() => import("@/components/layout/DarkSidebar"), { ssr: false });

export default function ProfilePage() {
  const { uploadId } = useParams<{ uploadId: string }>();
  const router = useRouter();
  const [result, setResult] = useState<ProfilingResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ColumnRole>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProfile(Number(uploadId))
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [uploadId]);

  function handleOverride(colName: string, role: ColumnRole) {
    setOverrides((prev) => ({ ...prev, [colName]: role }));
  }

  const overrideCount = Object.keys(overrides).length;

  // ── Type distribution counts ──────────────────────────────────────────────
  const dateCount = result?.columns.filter((c) => c.detected_type === "date").length ?? 0;
  const numericCount = result?.columns.filter((c) => c.detected_type === "numeric").length ?? 0;
  const catCount = result?.columns.filter((c) => c.detected_type === "categorical").length ?? 0;
  const textCount = result?.columns.filter((c) => c.detected_type === "text").length ?? 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <DarkSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Column Profile</h1>
            <p className="text-xs text-gray-400">
              Upload #{uploadId}
              {result && ` · ${result.row_count.toLocaleString()} rows · ${result.columns.length} columns`}
            </p>
          </div>
          <StepIndicator current={2} />
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#F4F6FA] px-6 py-5">

          {/* Error state */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              <span className="font-semibold">Error: </span>{error}
            </div>
          )}

          {/* Loading state */}
          {!result && !error && (
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
              <span className="text-sm text-gray-500">Detecting column types…</span>
            </div>
          )}

          {result && (
            <>
              {/* Stats row */}
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Rows</p>
                  <p className="mt-1 text-2xl font-bold text-gray-800">{result.row_count.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Columns</p>
                  <p className="mt-1 text-2xl font-bold text-gray-800">{result.columns.length}</p>
                </div>
                <div className={`rounded-xl border px-4 py-3 shadow-sm ${result.duplicate_row_count > 0 ? "border-amber-100 bg-amber-50" : "border-gray-100 bg-white"}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Duplicates</p>
                  <p className={`mt-1 text-2xl font-bold ${result.duplicate_row_count > 0 ? "text-amber-600" : "text-gray-800"}`}>
                    {result.duplicate_row_count.toLocaleString()}
                  </p>
                </div>
                {[
                  { label: "Date", count: dateCount, color: "text-purple-600" },
                  { label: "Numeric", count: numericCount, color: "text-emerald-600" },
                  { label: "Categorical", count: catCount, color: "text-[#00B5AD]" },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t.label}</p>
                    <p className={`mt-1 text-2xl font-bold ${t.color}`}>{t.count}</p>
                  </div>
                ))}
              </div>

              {/* Instruction banner */}
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#00B5AD]/20 bg-[#00B5AD]/5 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#00B5AD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <p className="text-xs text-[#00897B]">
                  Review the detected column types and roles below. Correct any that look wrong before the AI maps them to KPI fields.
                  {overrideCount > 0 && (
                    <span className="ml-1 font-semibold text-[#00B5AD]">
                      {overrideCount} override{overrideCount > 1 ? "s" : ""} applied.
                    </span>
                  )}
                </p>
              </div>

              {/* Column table card */}
              <div className="mb-5 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <div className="border-b border-gray-50 px-5 py-3.5">
                  <SectionHeader
                    title="Detected Columns"
                    subtitle={`${dateCount} date · ${numericCount} numeric · ${catCount} categorical · ${textCount} text`}
                  />
                </div>
                <ColumnTable columns={result.columns} overrides={overrides} onOverride={handleOverride} />
              </div>

              {/* Action bar */}
              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                <button
                  onClick={() => router.push("/upload")}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Upload different file
                </button>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const params = new URLSearchParams({ uploadId: uploadId!, overrides: JSON.stringify(overrides) });
                      router.push(`/interview?${params}`);
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    title="Use AI interview to configure a reusable recipe"
                  >
                    <svg className="h-4 w-4 text-[#00B5AD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                    AI Interview
                  </button>

                  <button
                    onClick={() => router.push(`/mapping/${uploadId}`)}
                    className="flex items-center gap-2 rounded-lg bg-[#00B5AD] px-5 py-2 text-sm font-semibold text-white hover:bg-[#009A93]"
                  >
                    Map Columns
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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
