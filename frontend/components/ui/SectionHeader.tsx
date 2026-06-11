export default function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[3px] h-[18px] bg-signal rounded-full flex-shrink-0" />
      <div>
        <h2 className="text-[11px] font-extrabold text-ink uppercase tracking-[0.12em]">{title}</h2>
        {subtitle && <p className="text-[10px] text-mist mt-0.5 font-mono">{subtitle}</p>}
      </div>
    </div>
  );
}
