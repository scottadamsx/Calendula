"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendulaMark } from "@/components/brand/CalendulaMark";

const NAV = [
  { href: "/", label: "Chat" },
  { href: "/history", label: "History" },
  { href: "/week", label: "Week" },
  { href: "/audit", label: "Audit" },
  { href: "/meetings", label: "Meetings" },
  { href: "/reminders", label: "Reminders" },
  { href: "/planning", label: "Planning" },
  { href: "/checkin", label: "Check-in" },
  { href: "/advisor", label: "Advisor" },
  { href: "/settings", label: "Settings" },
  { href: "/connectors", label: "Connectors" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/status", label: "Build status" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-[258px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 px-5 h-[74px] border-b border-line">
        <CalendulaMark size={28} />
        <span className="font-display font-semibold text-base text-ink">Calendula</span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "h-10 px-4 flex items-center rounded-sm text-sm font-medium transition-colors duration-150 ease-out",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-soft hover:bg-brand-50 hover:text-brand-700",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
