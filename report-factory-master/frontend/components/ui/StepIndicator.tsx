const STEPS = [
  { label: "Upload", short: "1" },
  { label: "Profile", short: "2" },
  { label: "Map Columns", short: "3" },
  { label: "Select KPIs", short: "4" },
  { label: "Dashboard", short: "5" },
];

interface Props {
  current: 1 | 2 | 3 | 4 | 5;
}

export default function StepIndicator({ current }: Props) {
  return (
    <nav className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;

        return (
          <div key={step.label} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-[#00B5AD] text-white"
                : done
                ? "text-[#00B5AD]"
                : "text-gray-400"
            }`}>
              {done ? (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  active ? "bg-white/20" : done ? "bg-[#00B5AD]/10" : "bg-gray-100"
                }`}>
                  {step.short}
                </span>
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 h-px w-4 ${num < current ? "bg-[#00B5AD]" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
