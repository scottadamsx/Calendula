import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  isPromotionCandidate,
  formatPromotionProposal,
  isDemotionCandidate,
  formatDemotionProposal,
  demotedReminderDueAt,
  DEFAULT_PROMOTED_TASK_MINUTES,
} from "./promotionDemotion";

const zone = "America/St_Johns";
function local(y: number, m: number, d: number, h = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h }, { zone }).toJSDate();
}

describe("isPromotionCandidate (spec §16 Phase 6.5 acceptance)", () => {
  const now = local(2026, 9, 15);

  it("a reminder deferred three times (the default threshold) is a candidate", () => {
    const candidate = isPromotionCandidate(
      { status: "pending", kind: "moment", deferCount: 3, createdAt: local(2026, 9, 14), promotionOffered: false },
      now,
      3,
    );
    expect(candidate).toBe(true);
  });

  it("is a candidate once pending and non-latent for more than 7 days, even with zero defers", () => {
    const candidate = isPromotionCandidate(
      { status: "pending", kind: "moment", deferCount: 0, createdAt: local(2026, 9, 1), promotionOffered: false },
      now,
      3,
    );
    expect(candidate).toBe(true);
  });

  it("is never a candidate once already offered — offered once, ever", () => {
    const candidate = isPromotionCandidate(
      { status: "pending", kind: "moment", deferCount: 5, createdAt: local(2026, 9, 1), promotionOffered: true },
      now,
      3,
    );
    expect(candidate).toBe(false);
  });

  it("excludes latent reminders", () => {
    const candidate = isPromotionCandidate(
      { status: "pending", kind: "latent", deferCount: 10, createdAt: local(2026, 1, 1), promotionOffered: false },
      now,
      3,
    );
    expect(candidate).toBe(false);
  });
});

describe("formatPromotionProposal", () => {
  it("matches the spec's own example shape and includes the default estimate", () => {
    const msg = formatPromotionProposal({ reminderId: "a", title: "Fix the portfolio contact form", deferCount: 4, createdAt: local(2026, 9, 1) });
    expect(msg).toContain("Fix the portfolio contact form");
    expect(msg).toContain("4 times");
    expect(msg).toContain(`${DEFAULT_PROMOTED_TASK_MINUTES} minutes`);
  });
});

describe("isDemotionCandidate", () => {
  it("flags a small task skipped 3+ times", () => {
    expect(isDemotionCandidate({ status: "active", skipCount: 3, estimatedMinutes: 20, demotionOffered: false })).toBe(true);
  });

  it("does not flag a task over 30 minutes even if skipped repeatedly", () => {
    expect(isDemotionCandidate({ status: "active", skipCount: 5, estimatedMinutes: 45, demotionOffered: false })).toBe(false);
  });

  it("does not re-flag an already-offered task", () => {
    expect(isDemotionCandidate({ status: "active", skipCount: 5, estimatedMinutes: 20, demotionOffered: true })).toBe(false);
  });
});

describe("formatDemotionProposal", () => {
  it("names the task and the skip count", () => {
    const msg = formatDemotionProposal({ taskId: "a", title: "Reply to that one email", skipCount: 3, estimatedMinutes: 15 });
    expect(msg).toContain("Reply to that one email");
    expect(msg).toContain("3 times");
  });
});

describe("demotedReminderDueAt", () => {
  it("is tomorrow morning, not immediate", () => {
    const now = local(2026, 9, 15, 14);
    const due = demotedReminderDueAt(now, zone);
    const dt = DateTime.fromJSDate(due, { zone });
    expect(dt.day).toBe(16);
    expect(dt.hour).toBe(9);
  });
});
