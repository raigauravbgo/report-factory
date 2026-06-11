"use client";

interface Props {
  title: string;
  subtitle?: string;
  takeaway?: string;
  children: React.ReactNode;
}

export default function ChartCard({ title, subtitle, takeaway, children }: Props) {
  return (
    <div className="bg-card rounded-xl border border-rim flex flex-col overflow-hidden shadow-sm hover:shadow-md hover:border-edge transition-all duration-200">
      {/* Card header */}
      <div className="px-5 pt-4 pb-3 border-b border-rim">
        <h3 className="text-[13px] font-semibold text-ink leading-snug">{title}</h3>
        {subtitle && <p className="text-[10px] text-mist mt-0.5 font-mono">{subtitle}</p>}
      </div>

      {/* Chart area */}
      <div className="flex-1 px-4 pt-3 pb-2">{children}</div>

      {/* Takeaway footer */}
      {takeaway && (
        <div className="px-5 py-3 border-t border-rim bg-raised/40 flex items-start gap-2.5">
          <span className="text-signal flex-shrink-0 text-[11px] mt-0.5 font-bold">↳</span>
          <p className="text-[11px] text-dim leading-relaxed">{takeaway}</p>
        </div>
      )}
    </div>
  );
}
