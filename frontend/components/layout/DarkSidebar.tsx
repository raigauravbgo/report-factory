"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { label: "Library", href: "/", icon: "▦" },
  { label: "Upload", href: "/upload", icon: "↑" },
  { label: "Review Queue", href: "/review-queue", icon: "✓" },
];

export default function DarkSidebar() {
  const path = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-[#1B2340] flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <span className="text-white font-bold text-lg tracking-tight">BGO</span>
        <span className="text-[#00B5AD] font-bold text-lg"> Report Factory</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 pt-4 space-y-1 px-3">
        {NAV.map((item) => {
          const active = path === item.href || path.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                active
                  ? "border-l-4 border-[#00B5AD] bg-white/10 text-white font-medium pl-2"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-white/40 text-xs">BGO Report Factory v1.0</p>
      </div>
    </aside>
  );
}
