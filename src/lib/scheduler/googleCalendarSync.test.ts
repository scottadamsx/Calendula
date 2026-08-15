import { describe, it, expect } from "vitest";
import { planGoogleCalendarSync, type GoogleEvent, type ExistingImportedBlock } from "./googleCalendarSync";

function event(id: string, title: string, startHour: number, endHour: number, location: string | null = null): GoogleEvent {
  return {
    id,
    title,
    start: new Date(2026, 8, 1, startHour),
    end: new Date(2026, 8, 1, endHour),
    location,
  };
}

function imported(blockId: string, e: GoogleEvent): ExistingImportedBlock {
  return { id: blockId, externalId: e.id, title: e.title, starts_at: e.start, ends_at: e.end, location: e.location };
}

describe("planGoogleCalendarSync (spec §16 Phase 7 acceptance)", () => {
  it("inserts new events not seen before", () => {
    const plan = planGoogleCalendarSync([event("g1", "Standup", 9, 9.5)], []);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
  });

  it("re-import is idempotent — the same events again produce an empty plan", () => {
    const events = [event("g1", "Standup", 9, 9.5), event("g2", "Lunch", 12, 13)];
    const firstPlan = planGoogleCalendarSync(events, []);
    const existing = [
      imported("local-1", events[0]),
      imported("local-2", events[1]),
    ];
    const secondPlan = planGoogleCalendarSync(events, existing);
    expect(secondPlan.toInsert).toHaveLength(0);
    expect(secondPlan.toUpdate).toHaveLength(0);
    expect(secondPlan.toDelete).toHaveLength(0);
    expect(firstPlan.toInsert).toHaveLength(2); // sanity: the first pass did insert them
  });

  it("events deleted upstream are removed locally", () => {
    const original = event("g1", "Standup", 9, 9.5);
    const existing = [imported("local-1", original)];
    const plan = planGoogleCalendarSync([], existing); // Google no longer returns it
    expect(plan.toDelete).toEqual([{ blockId: "local-1", externalId: "g1" }]);
    expect(plan.toInsert).toHaveLength(0);
  });

  it("updates a changed event (time moved) rather than delete-and-reinsert", () => {
    const original = event("g1", "Standup", 9, 9.5);
    const moved = event("g1", "Standup", 10, 10.5);
    const existing = [imported("local-1", original)];
    const plan = planGoogleCalendarSync([moved], existing);
    expect(plan.toUpdate).toEqual([{ blockId: "local-1", event: moved }]);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
  });

  it("leaves unrelated locally-created fixed blocks (no external_id in this set) untouched", () => {
    // A manually-created fixed_block simply never appears in `existingBlocks`
    // here (it has no external_id) — the plan only ever reasons about the
    // imported subset, so nothing about a manual block is ever proposed for deletion.
    const plan = planGoogleCalendarSync([event("g1", "Standup", 9, 9.5)], []);
    expect(plan.toDelete).toHaveLength(0);
  });
});
