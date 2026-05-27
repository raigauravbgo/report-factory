"use client";

import { useState } from "react";
import type { MappingEntry, MappingStatus } from "@/lib/types";

interface Props {
  mapping: Record<string, MappingEntry>;
  onChange: (updated: Record<string, MappingEntry>) => void;
}

const STATUS_CONFIG: Record<MappingStatus, { label: string; cls: string; dotCls: string }> = {
  auto:          { label: "Auto",    cls: "bg-emerald-50 text-emerald-700 border border-emerald-100", dotCls: "bg-emerald-500" },
  review_needed: { label: "Review",  cls: "bg-amber-50 text-amber-700 border border-amber-100",       dotCls: "bg-amber-400"   },
  manual:        { label: "Manual",  cls: "bg-[#00B5AD]/10 text-[#00897B] border border-[#00B5AD]/20", dotCls: "bg-[#00B5AD]" },
  ignored:       { label: "Ignored", cls: "bg-gray-50 text-gray-400 border border-gray-200",           dotCls: "bg-gray-300"   },
};

export default function MappingTable({ mapping, onChange }: Props) {
  const [local, setLocal] = useState<Record<string, MappingEntry>>(mapping);

  function update(col: string, patch: Partial<MappingEntry>) {
    const updated = { ...local, [col]: { ...local[col], ...patch } };
    setLocal(updated);
    onChange(updated);
  }

  const entries = Object.entries(local);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-50 text-sm">
        <thead className="bg-gray-50/70">
          <tr>
            {[
              { label: "Original Column", align: "text-left" },
              { label: "Mapped To (canonical name)", align: "text-left" },
              { label: "Confidence", align: "text-center" },
              { label: "Status", align: "text-center" },
            ].map((h) => (
              <th
                key={h.label}
                className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${h.align}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {entries.map(([col, entry], idx) => {
            const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.review_needed;
            const pct = Math.round((entry.confidence ?? 0) * 100);
            const isIgnored = entry.status === "ignored";

            return (
              <tr
                key={col}
                className={`transition-colors hover:bg-gray-50/60 ${isIgnored ? "opacity-40" : ""} ${idx % 2 === 0 ? "" : "bg-gray-50/20"}`}
              >
                {/* Original column */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs font-semibold text-gray-800">{col}</span>
                </td>

                {/* Editable canonical name */}
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={entry.canonical_name}
                    onChange={(e) => update(col, { canonical_name: e.target.value, status: "manual" })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-mono text-xs text-gray-800 focus:border-[#00B5AD] focus:outline-none focus:ring-1 focus:ring-[#00B5AD]"
                    placeholder="canonical_name"
                  />
                  {entry.reasoning && (
                    <p className="mt-0.5 truncate text-[10px] text-gray-400">{entry.reasoning}</p>
                  )}
                </td>

                {/* Confidence bar */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-[#00B5AD]" : pct >= 30 ? "bg-amber-400" : "bg-gray-300"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-[#00897B]" : pct >= 30 ? "text-amber-600" : "text-gray-400"
                    }`}>
                      {pct}%
                    </span>
                  </div>
                </td>

                {/* Status selector */}
                <td className="px-4 py-2.5 text-center">
                  <div className="inline-flex items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dotCls}`} />
                    <select
                      value={entry.status}
                      onChange={(e) => update(col, { status: e.target.value as MappingStatus })}
                      className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-[#00B5AD] ${cfg.cls}`}
                    >
                      <option value="auto">Auto</option>
                      <option value="review_needed">Review</option>
                      <option value="manual">Manual</option>
                      <option value="ignored">Ignored</option>
                    </select>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
