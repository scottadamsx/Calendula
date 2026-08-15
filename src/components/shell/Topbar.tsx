"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendulaMark } from "@/components/brand/CalendulaMark";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/week", label: "Week" },
  { href: "/meetings", label: "Meetings" },
  { href: "/reminders", label: "Reminders" },
  { href: "/planning", label: "Planning" },
  { href: "/checkin", label: "Check-in" },
  { href: "/advisor", label: "Advisor" },
  { href: "/settings", label: "Settings" },
  { href: "/connectors", label: "Connectors" },
  { href: "/how-it-works", label: "How it works" },
];

/**
 * Mobile-only chrome (sidebar → drawer collapse, house style §10). Below
 * md the fixed sidebar disappears, so this carries the mark and nav instead.
 */
export function Topbar() {
  const pathname = usePathname();

  return (
    <header className="md:hidden sticky top-0 z-10 flex flex-col border-b border-line bg-surface/80 backdrop-blur">
      <div className="flex items-center gap-2 px-4 h-[62px]">
        <CalendulaMark size={24} />
        <span className="font-display font-semibold text-base text-ink">Calendula</span>
      </div>
      <nav className="flex gap-1 px-2 pb-2 overflow-x-auto">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "h-8 px-3 flex items-center whitespace-nowrap rounded-sm text-xs font-medium transition-colors duration-150 ease-out",
                active ? "bg-brand-50 text-brand-700" : "text-ink-soft hover:bg-brand-50",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
