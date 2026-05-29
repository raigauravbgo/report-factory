export function formatKpiValue(value: number | null, formula: string): string {
  if (value === null || value === undefined) return "—";
  const isRatio = formula.includes("/");
  const isMean = /^(mean|avg|average)\s*\(/i.test(formula.trim());

  if (isRatio) return `${(value * 100).toFixed(1)}%`;
  if (isMean) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatAxisValue(value: number, formula: string): string {
  if (formula.includes("/")) return `${(value * 100).toFixed(0)}%`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
