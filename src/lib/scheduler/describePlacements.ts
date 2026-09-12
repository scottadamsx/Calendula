import { DateTime } from "luxon";
import type { Placement } from "./types";

/** "Mon Sep 14, 4:00–6:00 PM; Tue Sep 15, 7:15–8:45 PM" for one source's placements, so a tool result can say *when*. */
export function describePlacements(
  placements: Placement[],
  sourceType: Placement["sourceType"],
  sourceId: string,
  timezone: string,
  withinDays?: number,
): string {
  const cutoff = withinDays ? Date.now() + withinDays * 24 * 60 * 60_000 : Infinity;
  const mine = placements
    .filter((p) => p.sourceType === sourceType && p.sourceId === sourceId && p.startsAt.getTime() < cutoff)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (mine.length === 0) return "nothing placed yet";
  return mine
    .map((p) => {
      const s = DateTime.fromJSDate(p.startsAt, { zone: timezone });
      const e = DateTime.fromJSDate(p.endsAt, { zone: timezone });
      return `${s.toFormat("ccc LLL d, h:mm")}–${e.toFormat("h:mm a")}`;
    })
    .join("; ");
}
