"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import UploadZone from "@/components/UploadZone";
import { api } from "@/lib/api";
import type { UploadStatus } from "@/lib/types";

type Stage = "idle" | "uploading" | "polling" | "done" | "error";

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Queued…",
  profiling: "Analysing columns…",
  profiled: "Done",
  failed: "Failed",
};

const STATUS_STYLE: Record<string, string> = {
  "Queued…":            "text-slate-500",
  "Analysing columns…": "text-blue-600",
  "Done":               "text-emerald-600",
  "Failed":             "text-red-600",
};

export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFiles(files: File[]) {
    setStage("uploading");
    setErrorMsg("");
    setFileStatuses(Object.fromEntries(files.map((f) => [f.name, "Uploading…"])));

    let datasetId: number;
    try {
      const res = await api.uploadFiles(files);
      datasetId = res.dataset_id;
      setFileStatuses(
        Object.fromEntries(res.uploads.map((u) => [u.filename, STATUS_LABEL[u.status]]))
      );
    } catch (e) {
      setErrorMsg(String(e));
      setStage("error");
      return;
    }

    setStage("polling");
    pollDataset(datasetId);
  }

  function pollDataset(datasetId: number) {
    const interval = setInterval(async () => {
      try {
        const res = await api.getDatasetUploads(datasetId);
        const statuses = Object.fromEntries(
          res.uploads.map((u) => [u.filename, STATUS_LABEL[u.status]])
        );
        setFileStatuses(statuses);

        const allDone = res.uploads.every((u) => u.status === "profiled" || u.status === "failed");
        const anyFailed = res.uploads.some((u) => u.status === "failed");

        if (allDone) {
          clearInterval(interval);
          if (anyFailed) {
            setErrorMsg("One or more files failed to process. Check file formats and retry.");
            setStage("error");
          } else {
            setStage("done");
            router.push(`/schema-mapping/${datasetId}`);
          }
        }
      } catch {
        clearInterval(interval);
        setErrorMsg("Lost connection to server.");
        setStage("error");
      }
    }, 2000);
  }

  const busy = stage === "uploading" || stage === "polling";

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      {/* Page heading */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-900">Upload your data</h1>
        <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
          Upload one or more Excel or CSV files. All files will be analysed together
          as one dataset and flow through the pipeline automatically.
        </p>
      </div>

      {/* Upload card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <UploadZone onFiles={handleFiles} disabled={busy} />

        {/* File status list */}
        {Object.keys(fileStatuses).length > 0 && (
          <ul className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {Object.entries(fileStatuses).map(([name, status]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="truncate text-[13px] font-medium text-slate-700">{name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  {busy && status !== "Done" && status !== "Failed" && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  )}
                  {status === "Done" && (
                    <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className={`text-[12px] font-medium ${STATUS_STYLE[status] ?? "text-slate-500"}`}>
                    {status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {stage === "error" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="mt-4 text-center text-[11px] text-slate-400">
        Supported formats: .xlsx, .csv · Max 50 MB per file
      </p>
    </div>
  );
}
