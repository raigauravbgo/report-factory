"use client";

interface Props {
  title: string;
  subtitle?: string;
  takeaway?: string;
  children: React.ReactNode;
}

export default function ChartCard({ title, subtitle, takeaway, children }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
      {takeaway && (
        <p className="mt-3 text-xs text-gray-500 border-t border-gray-100 pt-3 leading-relaxed">
          <span className="font-medium text-[#00B5AD]">↳ </span>{takeaway}
        </p>
      )}
    </div>
  );
}
