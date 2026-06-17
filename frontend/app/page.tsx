"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Dashboard {
  recipe_id: number;
  dataset_id: number | null;
  client_id: string;
  filenames: string[];
  kpi_names: string[];
  kpi_count: number;
  date_column: string;
  granularity: string;
  created_at: string | null;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 flex-shrink-0">
      <path d="M3.5 2h6l3 3v9a.5.5 0 01-.5.5h-8A.5.5 0 013 14V2.5A.5.5 0 013.5 2z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M9.5 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 flex-shrink-0">
      <path d="M2 12.5L5.5 8l2.5 2.5L11 5.5l3 2.5" stroke="currentColor"
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${BASE_URL}/api/dashboard`)
      .then((r) => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); })
      .then((data) => setDashboards(Array.isArray(data) ? data : []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = dashboards.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.filenames.some((f) => f.toLowerCase().includes(q)) ||
      d.kpi_names.some((k) => k.toLowerCase().includes(q)) ||
      d.client_id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#0F1629]">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between bg-[#1B2340]">
        <div>
          <h1 className="text-[15px] font-bold text-white tracking-tight">Dashboard Library</h1>
          <p className="text-[11px] text-[#94A3B8] mt-0.5">
            All your generated dashboards — click any to reopen instantly
          </p>
        </div>
        <button
          onClick={() => router.push("/upload")}
          className="rounded-lg bg-[#00B5AD] text-white px-5 py-2.5 text-[12px] font-semibold hover:bg-[#00B5AD]/90 transition-colors shadow-sm"
        >
          + New Dashboard
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-white/10 bg-[#1B2340]/50 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#64748B] pointer-events-none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search by file, KPI, or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0F1629] border border-white/10 text-white text-[11px] rounded-lg pl-8 pr-3 py-2 placeholder:text-[#64748B] focus:outline-none focus:border-[#00B5AD]/50"
          />
        </div>
        {!loading && (
          <span className="text-[10px] text-[#64748B] font-mono ml-auto">
            {filtered.length} dashboard{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex-1 p-6">
        {loading && (
          <div className="flex items-center justify-center py-24 gap-3 text-[#94A3B8] text-[12px]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00B5AD] border-t-transparent" />
            Loading dashboards…
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-900/20 border border-red-800 px-5 py-4 text-[12px] text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-16 h-16 rounded-2xl bg-[#1B2340] border-2 border-white/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-[#64748B]">
                <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-[14px]">
                {search ? "No dashboards match your search" : "No dashboards yet"}
              </p>
              <p className="text-[#94A3B8] text-[12px] mt-1">
                {search ? "Try a different search term" : "Upload data files to create your first dashboard"}
              </p>
            </div>
            {!search && (
              <button
                onClick={() => router.push("/upload")}
                className="rounded-lg bg-[#00B5AD] text-white px-5 py-2.5 text-[12px] font-semibold hover:bg-[#00B5AD]/90 transition-colors"
              >
                Create your first dashboard
              </button>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((d) => {
              const date = d.created_at
                ? new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : "—";
              return (
                <div
                  key={d.recipe_id}
                  onClick={() => router.push(`/dashboard/${d.recipe_id}`)}
                  className="bg-[#1B2340] rounded-xl border border-white/10 p-4 cursor-pointer hover:border-[#00B5AD]/40 hover:bg-[#243058] transition-all duration-200 group flex flex-col gap-3"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-mono text-[#00B5AD] bg-[#00B5AD]/10 px-2 py-0.5 rounded">
                      #{d.recipe_id}
                    </span>
                    <span className="text-[10px] text-[#64748B] font-mono">{date}</span>
                  </div>

                  {/* Files */}
                  <div className="space-y-1">
                    {d.filenames.slice(0, 3).map((f) => (
                      <div key={f} className="flex items-center gap-1.5 text-[#94A3B8]">
                        <FileIcon />
                        <span className="text-[11px] truncate">{f}</span>
                      </div>
                    ))}
                    {d.filenames.length > 3 && (
                      <span className="text-[10px] text-[#64748B]">+{d.filenames.length - 3} more files</span>
                    )}
                  </div>

                  {/* KPIs */}
                  {d.kpi_count > 0 && (
                    <div className="flex items-start gap-1.5 text-[#64748B]">
                      <ChartIcon />
                      <p className="text-[10px] leading-relaxed">
                        {d.kpi_names.slice(0, 3).join(", ")}
                        {d.kpi_count > 3 && ` +${d.kpi_count - 3} more`}
                      </p>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-[#64748B] capitalize">{d.granularity}</span>
                    <span className="text-[10px] text-[#00B5AD] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      Open →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
