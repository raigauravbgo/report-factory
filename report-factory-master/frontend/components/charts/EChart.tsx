"use client";

import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

interface Props {
  option: EChartsOption;
  height?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  className?: string;
}

export default function EChart({ option, height = "280px", onEvents, className }: Props) {
  return (
    <div className={className}>
      <ReactECharts
        option={option}
        style={{ height }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </div>
  );
}
