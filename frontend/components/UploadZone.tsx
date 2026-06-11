"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
}

const ACCEPTED = {
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
};
const MAX_MB = 50;

export default function UploadZone({ onFiles, disabled, maxFiles = 10 }: Props) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: { file: File; errors: readonly { message: string }[] }[]) => {
      setError(null);
      if (rejected.length > 0) {
        const msg = rejected[0].errors[0]?.message ?? "Invalid file";
        setError(msg);
        return;
      }
      if (accepted.length > 0) onFiles(accepted);
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles,
    maxSize: MAX_MB * 1024 * 1024,
    disabled,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={[
          "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-14 text-center transition-all duration-200 cursor-pointer overflow-hidden",
          isDragActive
            ? "border-signal bg-signal/5 scale-[1.01]"
            : disabled
            ? "border-rim opacity-50 cursor-not-allowed"
            : "border-edge hover:border-signal hover:bg-signal/3",
        ].join(" ")}
      >
        <input {...getInputProps()} />

        {/* Upload icon */}
        <div className={`w-14 h-14 rounded-full border-2 flex items-center justify-center mb-5 transition-colors
          ${isDragActive ? "border-signal bg-signal/10" : "border-edge bg-wash"}`}>
          <svg className={`h-6 w-6 transition-colors ${isDragActive ? "text-signal" : "text-dim"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>

        {isDragActive ? (
          <p className="text-signal font-semibold text-sm">Drop files here</p>
        ) : (
          <>
            <p className="font-semibold text-ink text-sm">Drag & drop or click to browse</p>
            <p className="mt-2 text-[11px] text-dim">
              .xlsx · .xls · .csv &nbsp;·&nbsp; max {MAX_MB}MB per file &nbsp;·&nbsp; up to {maxFiles} files
            </p>
          </>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-danger flex items-center gap-1.5 bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  );
}
