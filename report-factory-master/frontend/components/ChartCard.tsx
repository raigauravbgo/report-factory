"use client";

import dynamic from "next/dynamic";
import {
  Area, AreaChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { KpiResult } from "@/lib/types";
import type { EChartsOption } from "echarts";

// Load EChart only on client to avoid SSR issues
const EChart = dynamic(() => import("@/components/charts/EChart"), { ssr: false });

// ── Palette ───────────────────────────────────────────────────────────────────
const PALETTE = [
  "#00B5AD", "#6366F1", "#10B981", "#F59E0B",
  "#8B5CF6", "#EF4444", "#0EA5E9", "#EC4899",
  "#14B8A6", "#F97316",
];

const GRADIENT_TEAL_BLUE = {
  type: "linear" as const,
  x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [
    { offset: 0, color: "#00B5AD" },
    { offset: 1, color: "#6366F1" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function prepData(breakdown: Record<string, unknown>, limit = 15) {
  return Object.entries(breakdown)
    .map(([label, value]) => ({ label: String(label), value: Number(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// ── ECharts options builders ──────────────────────────────────────────────────
function barOption(
  data: { label: string; value: number }[],
  title: string
): EChartsOption {
  const maxLabelLen = Math.max(...data.map((d) => d.label.length), 10);
  const leftMargin = Math.min(maxLabelLen * 7 + 16, 180);

  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: leftMargin, right: 60, top: 8, bottom: 8, containLabel: false },
    xAxis: { type: "value", axisLabel: { fontSize: 11, color: "#9CA3AF" }, splitLine: { lineStyle: { color: "#F3F4F6" } } },
    yAxis: {
      type: "category",
      data: data.map((d) => d.label),
      axisLabel: { fontSize: 11, color: "#374151", width: leftMargin - 12, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [{
      type: "bar",
      data: data.map((d, i) => ({
        value: d.value,
        itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, 6, 6, 0] },
      })),
      label: { show: true, position: "right", fontSize: 11, color: "#6B7280", formatter: (p: { value: number }) => p.value.toLocaleString() },
      barMaxWidth: 28,
    }],
  };
}

function lineOption(
  data: { label: string; value: number }[],
): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 48, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: data.map((d) => d.label),
      axisLabel: { fontSize: 11, color: "#9CA3AF", rotate: data.length > 8 ? 30 : 0 },
      axisLine: { lineStyle: { color: "#E5E7EB" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: "#9CA3AF" },
      splitLine: { lineStyle: { color: "#F3F4F6" } },
    },
    series: [{
      type: "line",
      data: data.map((d) => d.value),
      smooth: true,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { color: "#00B5AD", width: 2.5 },
      itemStyle: { color: "#00B5AD" },
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(0,181,173,0.18)" },
            { offset: 1, color: "rgba(0,181,173,0)" },
          ],
        },
      },
    }],
  };
}

function pieOption(data: { label: string; value: number }[]): EChartsOption {
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, type: "scroll", textStyle: { fontSize: 11, color: "#6B7280" } },
    series: [{
      type: "pie",
      radius: ["38%", "68%"],
      center: ["50%", "44%"],
      data: data.map((d, i) => ({ name: d.label, value: d.value, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.15)" } },
    }],
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props { result: KpiResult }

export default function ChartCard({ result }: Props) {
  if (!result.breakdown || Object.keys(result.breakdown).length === 0) return null;

  const data = prepData(result.breakdown);

  // Detect if labels look like time series (months, years, dates)
  const looksLikeTimeSeries = data.length > 2 &&
    /^(\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4])/i.test(data[0]?.label ?? "");

  const effectiveType = result.chart_type === "line" || looksLikeTimeSeries ? "line" : result.chart_type;

  return (
    <div className="group overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-gray-50 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{result.name}</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {data.length} segments · {effectiveType} view
          </p>
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-50 text-gray-400 transition-colors group-hover:bg-[#00B5AD]/10 group-hover:text-[#00B5AD]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      </div>

      <div className="p-4">
        {effectiveType === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Label</th>
                  <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Value</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-gray-50/50" : ""}>
                    <td className="py-1.5 pr-4 text-xs text-gray-600">{row.label}</td>
                    <td className="py-1.5 font-mono text-xs font-semibold text-gray-900">
                      {row.value.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : effectiveType === "pie" ? (
          <EChart option={pieOption(data)} height="240px" />
        ) : effectiveType === "line" ? (
          <EChart option={lineOption(data)} height="240px" />
        ) : (
          // bar (default)
          <EChart option={barOption(data, result.name)} height={`${Math.max(200, data.length * 32 + 32)}px`} />
        )}
      </div>
    </div>
  );
}
