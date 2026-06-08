"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ColumnTable from "@/components/ColumnTable";
import { api } from "@/lib/api";
import type { ColumnRole, ProfilingResult } from "@/lib/types";

interface ColumnOverrideState {
  role?: ColumnRole;
  semanticTag?: import("@/lib/types").SemanticTag;
  inGrain?: boolean;
  inFilter?: boolean;
}

export default function ProfilePage() {
  const { uploadId } = useParams<{ uploadId: string }>();
  const router = useRouter();
  const [result, setResult] = useState<ProfilingResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ColumnOverrideState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProfile(Number(uploadId))
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [uploadId]);

  function handleOverride(colName: string, patch: Partial<ColumnOverrideState>) {
    setOverrides((prev) => ({ ...prev, [colName]: { ...prev[colName], ...patch } }));
  }

  function handleContinue() {
    // Phase 2 will navigate to the AI interview with the approved profile
    const params = new URLSearchParams({ uploadId, overrides: JSON.stringify(overrides) });
    router.push(`/interview?${params}`);
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 flex items-center gap-3 text-gray-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Loading profile…
      </main>
    );
  }

  const overrideCount = Object.keys(overrides).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Column profile</h1>
        <p className="mt-1 text-gray-500">
          {result.row_count.toLocaleString()} rows · {result.columns.length} columns
          {result.duplicate_row_count > 0 && (
            <span className="ml-2 text-amber-600">· {result.duplicate_row_count.toLocaleString()} duplicate rows detected</span>
          )}
        </p>
      </div>

      <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Review the detected types and roles below. Change any that look wrong before continuing.
        {overrideCount > 0 && <span className="ml-1 font-medium">({overrideCount} override{overrideCount > 1 ? "s" : ""})</span>}
      </div>

      <ColumnTable columns={result.columns} overrides={overrides} onOverride={handleOverride} />

      <div className="flex justify-end gap-3">
        <button
          onClick={() => router.push("/upload")}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Upload different file
        </button>
        <button
          onClick={handleContinue}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Continue to interview →
        </button>
      </div>
    </main>
  );
}
