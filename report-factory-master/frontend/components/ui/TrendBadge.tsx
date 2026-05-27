interface Props {
  value: string | number;
  direction?: "up" | "down" | "flat";
  size?: "sm" | "md";
}

export default function TrendBadge({ value, direction = "flat", size = "sm" }: Props) {
  const isUp = direction === "up";
  const isDown = direction === "down";

  const colorClass = isUp
    ? "bg-green-100 text-green-700"
    : isDown
    ? "bg-red-100 text-red-700"
    : "bg-gray-100 text-gray-500";

  const arrow = isUp ? "▲" : isDown ? "▼" : "—";
  const textSize = size === "md" ? "text-sm" : "text-xs";

  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ${textSize} ${colorClass}`}>
      <span>{arrow}</span>
      <span>{value}</span>
    </span>
  );
}
