"use client";

import { useState } from "react";
import type { RelationshipSuggestion } from "@/lib/types";

interface Props {
  suggestions: RelationshipSuggestion[];
  onConfirm: (confirmed: RelationshipSuggestion[]) => void;
}

const REL_LABEL: Record<string, string> = {
  pk_fk: "Primary → Foreign Key",
  same_dimension: "Shared Dimension",
  shared_key: "Shared Key",
};

const REL_COLOR: Record<string, string> = {
  pk_fk: "bg-indigo-50 text-indigo-700 border-indigo-100",
  same_dimension: "bg-blue-50 text-blue-700 border-blue-100",
  shared_key: "bg-gray-50 text-gray-600 border-gray-100",
};

const CONF_COLOR = (c: number) =>
  c >= 0.85 ? "text-green-600" : c >= 0.7 ? "text-amber-600" : "text-gray-500";

export default function SchemaRelationships({ suggestions, onConfirm }: Props) {
  const [confirmed, setConfirmed] = useState<Set<number>>(
    new Set(suggestions.map((_, i) => i)),
  );

  const toggle = (i: number) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const handleConfirm = () => {
    onConfirm(suggestions.filter((_, i) => confirmed.has(i)));
  };

  if (suggestions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
        No cross-file relationships detected. Files will be kept separate.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {suggestions.length} potential relationship{suggestions.length !== 1 ? "s" : ""} detected.
          Check the ones to use as join keys.
        </p>
        <button
          onClick={handleConfirm}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1B2340] text-white hover:bg-[#243060]"
        >
          Confirm ({confirmed.size})
        </button>
      </div>

      <ul className="space-y-2">
        {suggestions.map((s, i) => (
          <li
            key={i}
            onClick={() => toggle(i)}
            className={`flex items-center gap-4 rounded-lg border px-4 py-3 cursor-pointer transition-opacity select-none
              ${confirmed.has(i) ? "" : "opacity-40"}
              ${REL_COLOR[s.relationship_type] ?? "bg-gray-50 text-gray-600 border-gray-100"}`}
          >
            <input
              type="checkbox"
              checked={confirmed.has(i)}
              onChange={() => toggle(i)}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded accent-teal-600 flex-shrink-0"
            />
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-mono font-medium">{s.file_a}</span>
              <span className="mx-1 text-gray-400">·</span>
              <span className="font-mono font-semibold">{s.col_a}</span>
              <span className="mx-2 text-gray-300">→</span>
              <span className="font-mono font-medium">{s.file_b}</span>
              <span className="mx-1 text-gray-400">·</span>
              <span className="font-mono font-semibold">{s.col_b}</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap">
              {REL_LABEL[s.relationship_type] ?? s.relationship_type}
            </span>
            <span className={`text-xs font-semibold ${CONF_COLOR(s.confidence)} flex-shrink-0`}>
              {Math.round(s.confidence * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
