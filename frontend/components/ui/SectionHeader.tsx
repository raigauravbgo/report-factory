export default function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-l-4 border-[#00B5AD] pl-3">
      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}
