"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import UploadZone from "@/components/UploadZone";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import type { UploadStatus } from "@/lib/types";

interface FileEntry {
  uploadId: number;
  filename: string;
  status: UploadStatus;
  error?: string;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Queued",
  profiling: "Analysing columns…",
  profiled: "Ready",
  failed: "Failed",
};

const STATUS_COLOR: Record<UploadStatus, string> = {
  pending: "bg-gray-100 text-gray-500",
  profiling: "bg-blue-50 text-blue-600",
  profiled: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-600",
};

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dimensions", "Dashboard"];

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const pollingRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  // C1: Clear all intervals on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      Object.values(pollingRef.current).forEach(clearInterval);
    };
  }, []);

  const handleFiles = useCallback(async (selected: File[]) => {
    setUploadError("");
    setUploading(true);

    const totalKB = selected.reduce((s, f) => s + f.size / 1024, 0);
    logEvent("files_selected", "upload", {
      count: selected.length,
      filenames: selected.map((f) => f.name),
      total_size_kb: Math.round(totalKB),
    });

    let batchRes;
    try {
      batchRes = await api.uploadBatch(selected);
    } catch (e) {
      setUploadError(String(e));
      setUploading(false);
      return;
    }

    logEvent("upload_started", "upload", { file_count: selected.length }, { datasetId: batchRes.dataset_id });
    setDatasetId(batchRes.dataset_id);
    // C2: Use actual status from API response instead of hardcoding "pending"
    const entries: FileEntry[] = batchRes.uploads.map((u) => ({
      uploadId: u.upload_id,
      filename: u.filename,
      status: (u.status ?? "pending") as UploadStatus,
    }));
    setFiles(entries);
    setUploading(false);

    // Poll each file independently
    for (const entry of batchRes.uploads) {
      const interval = setInterval(async () => {
        try {
          const res = await api.getUpload(entry.upload_id);
          setFiles((prev) =>
            prev.map((f) =>
              f.uploadId === entry.upload_id
                ? { ...f, status: res.status, error: res.error_message ?? f.error }
                : f,
            ),
          );
          if (res.status === "profiled" || res.status === "failed") {
            clearInterval(pollingRef.current[entry.upload_id]);
            delete pollingRef.current[entry.upload_id];
            logEvent("upload_file_profiled", "upload", {
              upload_id: entry.upload_id,
              filename: entry.filename,
              status: res.status,
            });
          }
        } catch {
          clearInterval(pollingRef.current[entry.upload_id]);
          setFiles((prev) =>
            prev.map((f) =>
              f.uploadId === entry.upload_id
                ? { ...f, status: "failed", error: "Connection lost" }
                : f,
            ),
          );
        }
      }, 2000);
      pollingRef.current[entry.upload_id] = interval;
    }
  }, []);

  const allProfiled = files.length > 0 && files.every((f) => f.status === "profiled");
  const anyFailed = files.some((f) => f.status === "failed");

  const handleContinue = () => {
    if (!datasetId) return;
    sessionStorage.setItem(
      `dataset_${datasetId}_uploads`,
      JSON.stringify(files.map((f) => ({ uploadId: f.uploadId, filename: f.filename }))),
    );
    logEvent("continue_to_schema", "upload", { upload_count: files.length }, { datasetId });
    router.push(`/session/${datasetId}/schema`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-lg font-bold text-[#1B2340]">Upload Data</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Upload one or more Excel / CSV files to generate a dashboard
        </p>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-6">

          {/* Step indicator */}
          <div className="flex items-center gap-1 text-xs">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-1">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                  ${i === 0 ? "bg-[#1B2340] text-white" : "bg-gray-100 text-gray-400"}`}>
                  {i + 1}
                </div>
                <span className={i === 0 ? "text-[#1B2340] font-semibold" : "text-gray-400"}>{step}</span>
                {i < STEPS.length - 1 && <span className="text-gray-200 mx-1">›</span>}
              </div>
            ))}
          </div>

          {/* Upload card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 space-y-5">
            <UploadZone onFiles={handleFiles} disabled={uploading || files.length > 0} />

            {uploading && (
              <div className="flex items-center gap-3 text-sm text-gray-500 bg-blue-50 rounded-lg px-4 py-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent flex-shrink-0" />
                Uploading files…
              </div>
            )}

            {uploadError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {uploadError}
              </div>
            )}

            {/* Per-file status list */}
            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Files ({files.length})
                </p>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                  {files.map((f) => (
                    <li key={f.uploadId} className="flex items-center justify-between px-4 py-3 bg-white">
                      <div className="flex items-center gap-3 min-w-0">
                        <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-sm text-gray-700 truncate">{f.filename}</span>
                        {f.error && <span className="text-xs text-red-500 ml-1">{f.error}</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {f.status === "profiling" && (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[f.status]}`}>
                          {STATUS_LABEL[f.status]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* CTA row */}
            {files.length > 0 && (
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => {
                    // M1: Clear all active polling intervals before resetting state
                    Object.values(pollingRef.current).forEach(clearInterval);
                    pollingRef.current = {};
                    setFiles([]); setDatasetId(null); setUploadError("");
                  }}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  Upload different files
                </button>
                <button
                  onClick={handleContinue}
                  disabled={!allProfiled}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
                    ${allProfiled
                      ? "bg-[#1B2340] text-white hover:bg-[#243060]"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                >
                  {allProfiled
                    ? "Continue to Schema Mapping →"
                    : anyFailed
                    ? "Some files failed — retry or remove"
                    : "Waiting for profiling…"}
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center">
            .xlsx, .xls, .csv — max 50MB per file · up to 10 files
          </p>
        </div>
      </div>
    </div>
  );
}
