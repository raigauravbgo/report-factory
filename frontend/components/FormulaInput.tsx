"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ValidationResult } from "@/lib/types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  availableColumns: string[];
  onValidation?: (result: ValidationResult) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function FormulaInput({
  value,
  onChange,
  availableColumns,
  onValidation,
  placeholder = "e.g. payments / contacts",
  disabled,
}: Props) {
  const [status, setStatus] = useState<"idle" | "validating" | "valid" | "error" | "warning">("idle");
  const [messages, setMessages] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      setStatus("idle");
      setMessages([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setStatus("validating");
      try {
        const result = await api.validateKpiFormula(value, availableColumns);
        onValidation?.(result);
        const errs = result.errors.filter((e) => e.severity === "error");
        const warns = result.errors.filter((e) => e.severity === "warning");
        if (errs.length > 0) {
          setStatus("error");
          setMessages(errs.map((e) => e.message));
        } else if (warns.length > 0) {
          setStatus("warning");
          setMessages(warns.map((e) => e.message));
        } else {
          setStatus("valid");
          setMessages([]);
        }
      } catch {
        setStatus("idle");
        setMessages([]);
      }
    }, 500);
  }, [value, availableColumns]);

  const borderClass =
    status === "error"
      ? "border-red-400 focus:ring-red-300"
      : status === "valid"
      ? "border-green-400 focus:ring-green-200"
      : status === "warning"
      ? "border-amber-400 focus:ring-amber-200"
      : "border-gray-300 focus:ring-blue-200";

  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={[
            "w-full rounded-md border px-3 py-2 pr-8 font-mono text-sm shadow-sm outline-none focus:ring-2 transition-colors",
            borderClass,
            disabled ? "bg-gray-50 text-gray-400" : "bg-white",
          ].join(" ")}
        />
        <span className="pointer-events-none absolute right-2 top-2.5 text-sm">
          {status === "validating" && (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          )}
          {status === "valid" && <span className="text-green-500">✓</span>}
          {status === "error" && <span className="text-red-500">✗</span>}
          {status === "warning" && <span className="text-amber-500">⚠</span>}
        </span>
      </div>
      {messages.map((m, i) => (
        <p
          key={i}
          className={`text-xs ${status === "error" ? "text-red-600" : "text-amber-600"}`}
        >
          {m}
        </p>
      ))}
    </div>
  );
}
