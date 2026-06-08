// Columns whose name explicitly signals a 0–100 or 0–1 percentage value
const _PCT_NAME_RE = /\b(percent|pct)\b/i;

function _isPercent(formula: string, fmt?: string): boolean {
  return fmt === "percentage" || formula.includes("/") || _PCT_NAME_RE.test(formula);
}

function _pctValue(value: number): number {
  // Values already in 0–100 range → display directly as "%"
  // Values in 0–1 fraction range → multiply by 100
  return value > 0 && value <= 1 ? value * 100 : value;
}

export function formatKpiValue(value: number | null, formula: string, fmt?: string): string {
  if (value === null || value === undefined) return "—";
  const isMean = /^(mean|avg|average)\s*\(/i.test(formula.trim());

  if (_isPercent(formula, fmt)) {
    return `${_pctValue(value).toFixed(1)}%`;
  }
  if (isMean) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatAxisValue(value: number, formula: string, fmt?: string): string {
  if (_isPercent(formula, fmt)) return `${_pctValue(value).toFixed(0)}%`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
