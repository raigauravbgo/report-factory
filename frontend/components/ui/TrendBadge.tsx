export default function TrendBadge({
  value,
  direction,
}: {
  value: string;
  direction: "up" | "down" | "flat";
}) {
  const styles = {
    up:   "bg-grow/10 text-grow border border-grow/20",
    down: "bg-danger/10 text-danger border border-danger/20",
    flat: "bg-wash text-dim border border-rim",
  };
  const arrows = { up: "▲", down: "▼", flat: "—" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[direction]}`}>
      <span className="text-[8px]">{arrows[direction]}</span>
      {value}
    </span>
  );
}
