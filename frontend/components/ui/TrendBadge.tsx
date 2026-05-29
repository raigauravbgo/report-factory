export default function TrendBadge({
  value,
  direction,
}: {
  value: string;
  direction: "up" | "down" | "flat";
}) {
  const styles = {
    up: "bg-green-100 text-green-700",
    down: "bg-red-100 text-red-700",
    flat: "bg-gray-100 text-gray-500",
  };
  const arrows = { up: "▲", down: "▼", flat: "—" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[direction]}`}>
      {arrows[direction]} {value}
    </span>
  );
}
