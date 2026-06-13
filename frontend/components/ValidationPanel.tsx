"use client";

import type { ValidationResult } from "@/lib/types";

interface Props {
  validation: ValidationResult;
  className?: string;
}

export default function ValidationPanel({ validation, className = "" }: Props) {
  if (validation.errors.length === 0) return null;

  const errors = validation.errors.filter((e) => e.severity === "error");
  const warnings = validation.errors.filter((e) => e.severity === "warning");

  return (
    <div className={`space-y-2 ${className}`}>
      {errors.map((e, i) => (
        <div key={i} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            <span className="font-medium">{e.field}:</span> {e.message}
          </span>
        </div>
      ))}
      {warnings.map((e, i) => (
        <div key={i} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            <span className="font-medium">{e.field}:</span> {e.message}
          </span>
        </div>
      ))}
    </div>
  );
}
