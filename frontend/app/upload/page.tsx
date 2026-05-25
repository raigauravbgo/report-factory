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
    pollStatus(uploadId);
  }

  function pollStatus(uploadId: number) {
    const interval = setInterval(async () => {
      try {
        const res = await api.getUpload(uploadId);
        setStatusMsg(STATUS_LABEL[res.status]);

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
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">Upload your data</h1>
      <p className="mb-8 text-gray-500">Upload an Excel or CSV file to get started.</p>

      <UploadZone onFile={handleFile} disabled={busy} />

      {busy && (
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-600">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          {stage === "uploading" ? "Uploading…" : statusMsg || "Processing…"}
        </div>
      )}

      {stage === "error" && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</p>
      )}
    </main>
  );
}
