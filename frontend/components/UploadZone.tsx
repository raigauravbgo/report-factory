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
    (accepted: File[], rejected: { file: File; errors: { message: string }[] }[]) => {
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
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={[
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors cursor-pointer",
          isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <input {...getInputProps()} />
        <svg className="mb-4 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {isDragActive ? (
          <p className="text-blue-600 font-medium">Drop your files here</p>
        ) : (
          <>
            <p className="font-medium text-gray-700">Drag & drop files, or click to browse</p>
            <p className="mt-1 text-sm text-gray-500">
              .xlsx, .xls, .csv — max {MAX_MB}MB per file · up to {maxFiles} files
            </p>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
