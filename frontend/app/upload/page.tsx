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

const STEPS = ["Upload", "Profile", "Interview", "Recipe", "Dashboard"];

export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFile(file: File) {
    setStage("uploading");
    setErrorMsg("");
    let uploadId: number;
    try {
      const res = await api.uploadFile(file);
      uploadId = res.id;
    } catch (e) {
      setErrorMsg(String(e));
      setStage("error");
      return;
    }
    setStage("polling");
    const interval = setInterval(async () => {
      try {
        const res = await api.getUpload(uploadId);
        setStatusMsg(STATUS_LABEL[res.status]);
        if (res.status === "profiled") { clearInterval(interval); setStage("done"); router.push(`/profile/${uploadId}`); }
        else if (res.status === "failed") { clearInterval(interval); setErrorMsg("Profiling failed. Please try again."); setStage("error"); }
      } catch { clearInterval(interval); setErrorMsg("Lost connection to server."); setStage("error"); }
    }, 2000);
  }

  const busy = stage === "uploading" || stage === "polling";

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-lg font-bold text-[#1B2340]">Upload Data</h1>
        <p className="text-xs text-gray-400 mt-0.5">Upload an Excel or CSV file to generate a dashboard</p>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-lg space-y-6">

          {/* Steps */}
          <div className="flex items-center gap-1 text-xs">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-1">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                  ${i === 0 ? "bg-[#1B2340] text-white" : "bg-gray-100 text-gray-400"}`}>
                  {i + 1}
                </div>
                <span className={`${i === 0 ? "text-[#1B2340] font-semibold" : "text-gray-400"}`}>{step}</span>
                {i < STEPS.length - 1 && <span className="text-gray-200 mx-1">›</span>}
              </div>
            ))}
          </div>

          {/* Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 space-y-4">
            <UploadZone onFile={handleFile} disabled={busy} />
            {busy && (
              <div className="flex items-center gap-3 text-sm text-gray-500 bg-blue-50 rounded-lg px-4 py-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent flex-shrink-0" />
                {stage === "uploading" ? "Uploading file…" : statusMsg || "Processing…"}
              </div>
            )}
            {stage === "error" && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
            )}
          </div>
          <p className="text-xs text-gray-400 text-center">Supported: .xlsx, .csv — max 50MB</p>
        </div>
      </div>
    </div>
  );
}
