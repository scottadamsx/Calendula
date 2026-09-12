"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { EventCard, type EventCardProps } from "@/components/week/EventCard";

export interface GridDay {
  dateIso: string;
  label: string;
  isToday: boolean;
  events: Omit<EventCardProps, "timezone">[];
}

const HOUR_PX = 44;

/**
 * A real time grid: hours down the side, one column per day, blocks sized to
 * their duration so free time is visible as empty space. Range is 6:00 to
 * midnight, stretched earlier/later only if something is actually there.
 */
export function WeekGrid({ days, timezone }: { days: GridDay[]; timezone: string }) {
  const [now, setNow] = useState<DateTime | null>(null);
  useEffect(() => {
    const tick = () => setNow(DateTime.now().setZone(timezone));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [timezone]);

  let startHour = 6;
  let endHour = 24;
  for (const d of days) {
    for (const e of d.events) {
      const s = DateTime.fromISO(e.startIso, { zone: timezone });
      const en = DateTime.fromISO(e.endIso, { zone: timezone });
      const dayStart = DateTime.fromISO(d.dateIso, { zone: timezone }).startOf("day");
      startHour = Math.min(startHour, Math.floor(s.diff(dayStart, "hours").hours));
      endHour = Math.max(endHour, Math.ceil(en.diff(dayStart, "hours").hours));
    }
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const totalPx = hours.length * HOUR_PX;

  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
        <div className="border-b border-line" />
        {days.map((d) => (
          <div key={d.dateIso} className={`border-b border-l border-line px-2 py-2 ${d.isToday ? "bg-brand-50" : ""}`}>
            <div className={`text-[10px] font-extrabold uppercase tracking-[.07em] ${d.isToday ? "text-brand-700" : "text-ink-faint"}`}>{d.label.split(" ")[0]}</div>
            <div className={`text-sm font-semibold ${d.isToday ? "text-brand-700" : "text-ink"}`}>{d.label.split(" ").slice(1).join(" ")}</div>
          </div>
        ))}
      </div>
      <div className="grid overflow-x-auto" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
        <div className="relative" style={{ height: totalPx }}>
          {hours.map((h, i) => (
            <div key={h} className="absolute right-2 font-data text-[10px] text-ink-faint -translate-y-1/2" style={{ top: i * HOUR_PX }}>
              {i === 0 ? "" : DateTime.fromObject({ hour: h }).toFormat("h a")}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const dayStart = DateTime.fromISO(d.dateIso, { zone: timezone }).startOf("day").plus({ hours: startHour });
          const nowTop = d.isToday && now ? (now.diff(dayStart, "minutes").minutes / 60) * HOUR_PX : null;
          return (
            <div key={d.dateIso} className={`relative border-l border-line ${d.isToday ? "bg-brand-50/40" : ""}`} style={{ height: totalPx }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
              ))}
              {d.events.map((e) => {
                const s = DateTime.fromISO(e.startIso, { zone: timezone });
                const en = DateTime.fromISO(e.endIso, { zone: timezone });
                const top = Math.max(0, (s.diff(dayStart, "minutes").minutes / 60) * HOUR_PX);
                const height = Math.max(18, (en.diff(s, "minutes").minutes / 60) * HOUR_PX - 2);
                return (
                  <div key={`${e.sourceId}-${e.startIso}`} className="absolute inset-x-1" style={{ top: top + 1, height }}>
                    <EventCard {...e} timezone={timezone} layout="grid" />
                  </div>
                );
              })}
              {nowTop !== null && nowTop >= 0 && nowTop <= totalPx && (
                <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-0.5 bg-brand-600" />
                  <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-brand-600" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
