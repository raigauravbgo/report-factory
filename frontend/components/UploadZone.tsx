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
};
const MAX_MB = 50;

export default function UploadZone({ onFiles, disabled, maxFiles = 10 }: Props) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: import("react-dropzone").FileRejection[]) => {
      setError(null);
      if (rejected.length > 0) {
        const msg = rejected[0].errors[0]?.message ?? "Invalid file";
        setError(msg);
        return;
      }
      if (accepted.length > 0) {
        onFiles(accepted);
      }
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles,
    maxSize: MAX_MB * 1024 * 1024,
    disabled,
    multiple: true,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={[
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 py-14 text-center transition-colors cursor-pointer",
          isDragActive
            ? "border-blue-400 bg-blue-50/60"
            : "border-slate-200 hover:border-blue-400 hover:bg-slate-50",
          disabled ? "pointer-events-none opacity-50" : "",
        ].join(" ")}
      >
        <input {...getInputProps()} />
        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${isDragActive ? "bg-blue-100" : "bg-slate-100"}`}>
          <svg className={`h-6 w-6 ${isDragActive ? "text-blue-500" : "text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>
        {isDragActive ? (
          <p className="text-sm font-semibold text-blue-600">Drop files here…</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-700">
              Drag &amp; drop files here
            </p>
            <p className="mt-1 text-xs text-slate-400">or click to browse</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
