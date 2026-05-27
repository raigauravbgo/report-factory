"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = {
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};
const MAX_MB = 50;

export default function UploadZone({ onFile, disabled }: Props) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: { file: File; errors: { message: string }[] }[]) => {
      setError(null);
      if (rejected.length > 0) {
        setError(rejected[0].errors[0]?.message ?? "Invalid file");
        return;
      }
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: MAX_MB * 1024 * 1024,
    disabled,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={[
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-14 text-center transition-all cursor-pointer",
          isDragActive
            ? "border-[#00B5AD] bg-[#00B5AD]/5 scale-[1.01]"
            : "border-gray-200 hover:border-[#00B5AD]/60 hover:bg-[#00B5AD]/3",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <input {...getInputProps()} />

        {/* Upload icon */}
        <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
          isDragActive ? "bg-[#00B5AD]/15" : "bg-gray-100"
        }`}>
          <svg
            className={`h-7 w-7 transition-colors ${isDragActive ? "text-[#00B5AD]" : "text-gray-400"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>

        {isDragActive ? (
          <p className="font-semibold text-[#00B5AD]">Drop your file here</p>
        ) : (
          <>
            <p className="font-semibold text-gray-700">
              Drag & drop a file, or{" "}
              <span className="text-[#00B5AD] underline-offset-2 hover:underline">click to browse</span>
            </p>
            <p className="mt-1.5 text-sm text-gray-400">.xlsx or .csv — max {MAX_MB} MB</p>
          </>
        )}
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}
