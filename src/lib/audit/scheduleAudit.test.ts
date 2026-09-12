import { describe, expect, it } from "vitest";
import { auditSchedule, type AuditInput } from "./scheduleAudit";
import type { MergedPlacement } from "@/lib/scheduler/grid";

const at = (iso: string) => new Date(iso);
const profile = { timezone: "America/St_Johns", sleepStart: "23:00", sleepEnd: "07:00", maxTaskMinutesPerDay: 240 };
const p = (over: Partial<MergedPlacement> & { start: Date; end: Date }): MergedPlacement => ({ sourceId: "x", sourceType: "task", title: "t", state: "soft", ...over });

function base(placements: MergedPlacement[], extra: Partial<AuditInput> = {}): AuditInput {
  return { from: at("2026-09-14T00:00:00Z"), to: at("2026-09-21T00:00:00Z"), blocks: [], placements, tasks: [], habits: [], profile, ...extra };
}

describe("auditSchedule invariants", () => {
  it("passes a clean week", () => {
    const r = auditSchedule(base([
      p({ sourceId: "w", sourceType: "fixed", title: "Work", state: "hard", start: at("2026-09-14T11:30:00Z"), end: at("2026-09-14T18:30:00Z") }),
      p({ sourceId: "a", title: "Report", start: at("2026-09-14T18:30:00Z"), end: at("2026-09-14T20:30:00Z") }),
    ], { tasks: [{ id: "a", title: "Report", deadline: at("2026-09-18T19:30:00Z"), remainingMinutes: 120 }] }));
    expect(r.passed).toBe(6);
    expect(r.metrics.taskSlack[0].slackHours).toBeCloseTo(95, 0);
  });

  it("flags work placed on a commitment and the resulting overlap", () => {
    const r = auditSchedule(base([
      p({ sourceId: "w", sourceType: "fixed", title: "Work", state: "hard", start: at("2026-09-14T11:30:00Z"), end: at("2026-09-14T18:30:00Z") }),
      p({ sourceId: "a", title: "Report", start: at("2026-09-14T12:00:00Z"), end: at("2026-09-14T14:00:00Z") }),
    ]));
    const failed = r.invariants.filter((i) => !i.pass).map((i) => i.id);
    expect(failed).toEqual(["no-overlap", "respects-commitments"]);
  });

  it("flags a task that ends after its deadline and a habit spaced too tightly", () => {
    const r = auditSchedule(base([
      p({ sourceId: "a", title: "Report", start: at("2026-09-18T20:00:00Z"), end: at("2026-09-18T21:00:00Z") }),
      p({ sourceId: "h", sourceType: "habit", title: "Run", start: at("2026-09-15T12:00:00Z"), end: at("2026-09-15T12:40:00Z") }),
      p({ sourceId: "h", sourceType: "habit", title: "Run", start: at("2026-09-15T20:00:00Z"), end: at("2026-09-15T20:40:00Z") }),
    ], {
      tasks: [{ id: "a", title: "Report", deadline: at("2026-09-18T19:30:00Z"), remainingMinutes: 60 }],
      habits: [{ id: "h", title: "Run", targetSessionsPerWeek: 3, minSpacingHours: 24 }],
    }));
    const failed = r.invariants.filter((i) => !i.pass).map((i) => i.id);
    expect(failed).toEqual(["before-deadline", "habit-spacing"]);
  });

  it("flags scheduled work during sleep", () => {
    const r = auditSchedule(base([p({ sourceId: "a", title: "Late", start: at("2026-09-15T04:00:00Z"), end: at("2026-09-15T05:00:00Z") })]));
    expect(r.invariants.find((i) => i.id === "respects-sleep")!.pass).toBe(false);
  });
});
