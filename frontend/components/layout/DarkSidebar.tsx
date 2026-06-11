"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LibraryIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px]">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
    <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
    <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px]">
    <path d="M8 10.5V3.5M8 3.5L5.5 6M8 3.5L10.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const ReviewIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px]">
    <path d="M2.5 4h11M2.5 8h7M2.5 12h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="13" cy="11.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M12.3 11.5l.5.5.9-.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const NAV = [
  { label: "Library",      href: "/",            Icon: LibraryIcon },
  { label: "Upload",       href: "/upload",       Icon: UploadIcon  },
  { label: "Review Queue", href: "/review-queue", Icon: ReviewIcon  },
];

export default function DarkSidebar() {
  const path = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-[#1B2340] flex flex-col z-40 border-r border-white/10">
      {/* Logo */}
      <div className="px-5 py-[18px] border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 18 18" fill="none" className="w-4 h-4">
              <path d="M3 9l3 3 9-9" stroke="#00B5AD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="1" width="16" height="16" rx="3" stroke="#00B5AD" strokeWidth="1.5" strokeOpacity="0.4"/>
            </svg>
          </div>
          <div className="leading-tight">
            <p className="text-white text-[13px] font-bold tracking-tight">BGO</p>
            <p className="text-[#00B5AD] text-[9px] font-semibold tracking-[0.12em] uppercase">Report Factory</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 pt-3 px-2.5 space-y-0.5">
        {NAV.map(({ label, href, Icon }) => {
          const active =
            href === "/"
              ? path === "/"
              : path === href || path.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all
                ${active
                  ? "bg-white/10 text-white border-l-2 border-signal pl-[10px]"
                  : "text-white/50 hover:text-white hover:bg-white/5 border-l-2 border-transparent"
                }`}
            >
              <span className={`flex-shrink-0 transition-colors ${active ? "text-signal" : "text-white/40 group-hover:text-white/70"}`}>
                <Icon />
              </span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Divider + status */}
      <div className="mx-4 h-px bg-white/10 mb-4" />

      {/* Footer */}
      <div className="px-5 pb-5 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
          <p className="text-white/30 text-[10px] font-mono tracking-wide">v1.0 · Operational</p>
        </div>
      </div>
    </aside>
  );
}
