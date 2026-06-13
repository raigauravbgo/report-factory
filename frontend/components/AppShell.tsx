"use client";

import { usePathname } from "next/navigation";

const STEPS = [
  { key: "upload",               label: "Upload Data",     sub: "CSV / Excel files",   segment: "upload",               optional: false },
  { key: "schema-mapping",       label: "Schema Mapping",  sub: "Types & roles",        segment: "schema-mapping",       optional: false },
  { key: "data-modeling",        label: "Data Modeling",   sub: "Fact / dim tables",    segment: "data-modeling",        optional: false },
  { key: "interview",            label: "Interview",       sub: "Optional · can skip",  segment: "interview",            optional: true  },
  { key: "kpi-selection",        label: "KPI Selection",   sub: "Choose metrics",       segment: "kpi-selection",        optional: false },
  { key: "dimension-selection",  label: "Dimensions",      sub: "Slice & filter by",    segment: "dimension-selection",  optional: false },
  { key: "recipe",               label: "Recipe",          sub: "Review & approve",     segment: "recipe",               optional: false },
  { key: "dashboard",            label: "Dashboard",       sub: "Charts & insights",    segment: "dashboard",            optional: false },
];

function StepIcon({ isDone, isActive, n }: { isDone: boolean; isActive: boolean; n: number }) {
  if (isDone) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
        ✓
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white shadow-[0_0_0_3px_rgba(59,130,246,0.25)]">
        {n}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-medium text-slate-500">
      {n}
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeIndex = STEPS.findIndex((s) => pathname.startsWith(`/${s.segment}`));

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col bg-[#0d1117] select-none">

        {/* Brand */}
        <div className="border-b border-white/[0.07] px-5 pb-4 pt-5">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-500">BGO</p>
          <p className="mt-0.5 text-sm font-semibold leading-tight text-white">
            Report Factory
          </p>
          <p className="mt-0.5 text-[10px] text-slate-600">AI-powered BI</p>
        </div>

        {/* Pipeline steps */}
        <nav className="flex-1 overflow-y-auto px-4 py-5">
          <p className="mb-4 text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-600">
            Pipeline
          </p>

          <ol>
            {STEPS.map((step, i) => {
              const isActive = i === activeIndex;
              const isDone   = activeIndex > -1 && i < activeIndex;
              const isLast   = i === STEPS.length - 1;

              return (
                <li key={step.key} className="flex gap-3">
                  {/* Left column: icon + connector */}
                  <div className="flex flex-col items-center">
                    <StepIcon isDone={isDone} isActive={isActive} n={i + 1} />
                    {!isLast && (
                      <div
                        className={`my-1 w-px flex-1 ${
                          isDone ? "bg-emerald-800" : "bg-slate-800"
                        }`}
                        style={{ minHeight: "20px" }}
                      />
                    )}
                  </div>

                  {/* Right column: label */}
                  <div className={`min-w-0 ${isLast ? "pb-0" : "pb-4"} pt-0.5`}>
                    <div className="flex items-center gap-1.5 leading-none">
                      <p
                        className={`text-[12px] font-semibold ${
                          isActive ? "text-white" : isDone ? "text-slate-400" : "text-slate-600"
                        }`}
                      >
                        {step.label}
                      </p>
                      {step.optional && (
                        <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide bg-slate-800 text-slate-500">
                          opt
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 text-[10px] leading-tight ${
                        isActive ? "text-blue-300" : "text-slate-700"
                      }`}
                    >
                      {step.sub}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.07] px-5 py-3">
          <p className="text-[10px] text-slate-600">BGO AI Platform · v1.0</p>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 text-[11px]">
            {activeIndex > -1 ? (
              <>
                <span className="text-slate-400">Step {activeIndex + 1} / {STEPS.length}</span>
                <span className="text-slate-300">·</span>
                <span className="font-semibold text-slate-700">{STEPS[activeIndex].label}</span>
              </>
            ) : (
              <span className="text-slate-400">BGO Report Factory</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-block h-6 w-6 rounded-full bg-slate-200 text-center text-[10px] font-bold leading-6 text-slate-600">
              N
            </span>
          </div>
        </header>

        {/* Scrollable page content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
