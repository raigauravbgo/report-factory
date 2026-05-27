"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import UploadZone from "@/components/UploadZone";
import StepIndicator from "@/components/ui/StepIndicator";
import { api } from "@/lib/api";
import { FILE_TYPE_OPTIONS, type UploadStatus } from "@/lib/types";

const DarkSidebar = dynamic(() => import("@/components/layout/DarkSidebar"), { ssr: false });

type Stage = "idle" | "uploading" | "polling" | "done" | "error";

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Queued…",
  profiling: "Analysing columns…",
  profiled: "Done",
  failed: "Failed",
  analyzing: "Running analysis…",
  complete: "Complete",
};

export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [fileType, setFileType] = useState("unknown");

  async function handleFile(file: File) {
    setStage("uploading");
    setErrorMsg("");
    let uploadId: number;
    try {
      const res = await api.uploadFile(file, fileType);
      uploadId = res.id;
    } catch (e) {
      setErrorMsg(String(e));
      setStage("error");
      return;
    }
    setStage("polling");
    pollStatus(uploadId);
  }

  function pollStatus(uploadId: number) {
    const interval = setInterval(async () => {
      try {
        const res = await api.getUpload(uploadId);
        setStatusMsg(STATUS_LABEL[res.status] ?? res.status);
        if (res.status === "profiled") {
          clearInterval(interval);
          setStage("done");
          router.push(`/profile/${uploadId}`);
        } else if (res.status === "failed") {
          clearInterval(interval);
          setErrorMsg("Profiling failed. Please try again.");
          setStage("error");
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
    <div className="flex h-screen overflow-hidden">
      <DarkSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Upload Data</h1>
            <p className="text-xs text-gray-400">Start your analysis by uploading an Excel or CSV file</p>
          </div>
          <StepIndicator current={1} />
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-[#F4F6FA] px-6 py-6">
          <div className="mx-auto max-w-2xl">

            {/* File type card */}
            <div className="mb-5 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-[#00B5AD]" />
                <h2 className="text-sm font-semibold text-gray-800">What type of data are you uploading?</h2>
              </div>
              <p className="mb-4 text-xs text-gray-400">
                Selecting the right file type helps the AI map your columns to the correct KPI fields.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FILE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => !busy && setFileType(opt.value)}
                    disabled={busy}
                    className={`rounded-lg border-2 px-4 py-2.5 text-left text-sm font-medium transition-all ${
                      fileType === opt.value
                        ? "border-[#00B5AD] bg-[#00B5AD]/5 text-[#00B5AD]"
                        : "border-gray-100 bg-gray-50 text-gray-600 hover:border-[#00B5AD]/40"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Drop zone card */}
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-[#00B5AD]" />
                <h2 className="text-sm font-semibold text-gray-800">Upload your file</h2>
              </div>
              <UploadZone onFile={handleFile} disabled={busy} />

              {/* Progress feedback */}
              {busy && (
                <div className="mt-4 flex items-center gap-3 rounded-lg bg-[#00B5AD]/5 px-4 py-3">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {stage === "uploading" ? "Uploading file…" : statusMsg || "Processing…"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {stage === "polling"
                        ? "Detecting column types and running AI schema inference"
                        : "Sending file to server"}
                    </p>
                  </div>
                </div>
              )}

              {stage === "error" && (
                <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="font-semibold">Error: </span>{errorMsg}
                </div>
              )}
            </div>

            {/* Info strip */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#00B5AD]/20 bg-[#00B5AD]/5 px-4 py-3">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#00B5AD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-[#00897B]">
                After upload, the AI will automatically detect column types, infer canonical names, and
                identify which KPIs can be computed from your data.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
