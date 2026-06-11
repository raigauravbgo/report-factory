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
  pending:  "Queued",
  profiling: "Analysing…",
  profiled: "Ready",
  failed:   "Failed",
};

const STATUS_STYLE: Record<UploadStatus, string> = {
  pending:  "bg-wash text-mist border-rim",
  profiling: "bg-azure/10 text-azure border-azure/25",
  profiled: "bg-grow/10 text-grow border-grow/25",
  failed:   "bg-danger/10 text-danger border-danger/25",
};

const STEPS = ["Upload", "Schema", "Interview", "KPIs", "Dimensions", "Dashboard"];

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const pollingRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

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
    const entries: FileEntry[] = batchRes.uploads.map((u) => ({
      uploadId: u.upload_id,
      filename: u.filename,
      status: (u.status ?? "pending") as UploadStatus,
    }));
    setFiles(entries);
    setUploading(false);

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
      {/* Page header */}
      <div className="bg-card border-b border-rim px-6 py-4">
        <h1 className="text-[15px] font-bold text-ink tracking-tight">Upload Data</h1>
        <p className="text-[11px] text-mist mt-0.5">Upload one or more Excel / CSV files to generate a dashboard</p>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 py-10">
        <div className="w-full max-w-xl space-y-7">

          {/* Step indicator */}
          <div className="flex items-center">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all
                      ${i === 0
                        ? "bg-signal border-signal text-white"
                        : "bg-raised border-rim text-mist"}`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`text-[9px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap
                      ${i === 0 ? "text-signal" : "text-mist"}`}
                  >
                    {step}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="h-px w-6 bg-rim mx-1 mb-4 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Upload card */}
          <div className="bg-card rounded-xl border border-rim p-6 space-y-5">
            <UploadZone onFiles={handleFiles} disabled={uploading || files.length > 0} />

            {uploading && (
              <div className="flex items-center gap-3 text-[12px] text-azure bg-azure/5 border border-azure/20 rounded-lg px-4 py-3">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-signal border-t-transparent flex-shrink-0" />
                Uploading files…
              </div>
            )}

            {uploadError && (
              <div className="rounded-lg bg-danger/5 border border-danger/25 px-4 py-3 text-[12px] text-danger flex items-start gap-2">
                <span className="flex-shrink-0">⚠</span>
                <span>{uploadError}</span>
              </div>
            )}

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mist uppercase tracking-[0.1em]">
                  Files ({files.length})
                </p>
                <ul className="divide-y divide-rim border border-rim rounded-xl overflow-hidden">
                  {files.map((f) => (
                    <li key={f.uploadId} className="flex items-center justify-between px-4 py-3 bg-raised hover:bg-wash transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <svg className="h-4 w-4 text-mist flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="text-[12px] text-ink font-medium truncate">{f.filename}</span>
                        {f.error && <span className="text-[10px] text-danger ml-1">{f.error}</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {f.status === "profiling" && (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
                        )}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[f.status]}`}>
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
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => {
                    Object.values(pollingRef.current).forEach(clearInterval);
                    pollingRef.current = {};
                    setFiles([]);
                    setDatasetId(null);
                    setUploadError("");
                  }}
                  className="text-[11px] text-mist hover:text-dim transition-colors"
                >
                  Upload different files
                </button>
                <button
                  onClick={handleContinue}
                  disabled={!allProfiled}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold transition-all duration-200
                    ${allProfiled
                      ? "bg-signal text-white hover:bg-signal/90 shadow-sm"
                      : "bg-raised text-mist cursor-not-allowed border border-rim"}`}
                >
                  {allProfiled
                    ? <>Continue to Schema <span className="opacity-70">→</span></>
                    : anyFailed
                    ? "Some files failed"
                    : <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-mist/40 border-t-mist" />
                        Analysing…
                      </>
                  }
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
