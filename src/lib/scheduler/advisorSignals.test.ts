import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  rankOverloadTasks,
  formatOverloadMessage,
  formatDriftMessage,
  isEstimateDrifted,
  formatEstimateDriftMessage,
  type OverloadCandidate,
} from "./advisorSignals";

const zone = "America/St_Johns";

describe("rankOverloadTasks (spec §11 — priority ascending, slack descending)", () => {
  it("suggests the least-important task first, breaking ties toward the most slack", () => {
    const candidates: OverloadCandidate[] = [
      { taskId: "a", title: "Important thing", priority: 5, slackMinutes: 0 },
      { taskId: "b", title: "Low priority, tight", priority: 1, slackMinutes: 10 },
      { taskId: "c", title: "Low priority, loose", priority: 1, slackMinutes: 200 },
    ];
    const ranked = rankOverloadTasks(candidates);
    expect(ranked.map((r) => r.taskId)).toEqual(["c", "b", "a"]);
  });
});

describe("formatOverloadMessage (spec §11 — names the specific task, never 'you have a lot on')", () => {
  it("names the top candidates by title", () => {
    const msg = formatOverloadMessage([{ taskId: "a", title: "CP assignment", priority: 1, slackMinutes: 0 }]);
    expect(msg).toContain("CP assignment");
    expect(msg.toLowerCase()).not.toContain("you have a lot on");
  });

  it("is empty when nothing is overloaded", () => {
    expect(formatOverloadMessage([])).toBe("");
  });
});

describe("formatDriftMessage (spec §11's own example)", () => {
  it("mentions the person, the time since, and the free slot", () => {
    const msg = formatDriftMessage(
      {
        personName: "Nick",
        daysSince: 21,
        desiredCadenceDays: 14,
        freeSlot: { start: DateTime.fromObject({ year: 2026, month: 9, day: 2, hour: 19 }, { zone }).toJSDate(), end: DateTime.fromObject({ year: 2026, month: 9, day: 2, hour: 20 }, { zone }).toJSDate() },
      },
      zone,
    );
    expect(msg).toContain("Nick");
    expect(msg).toContain("3 weeks");
    expect(msg.toLowerCase()).toContain("wednesday");
  });

  it("is honest when there's no free slot to suggest", () => {
    const msg = formatDriftMessage({ personName: "Nick", daysSince: 21, desiredCadenceDays: 14, freeSlot: null }, zone);
    expect(msg).toContain("Nick");
    expect(msg.toLowerCase()).toContain("nothing open");
  });
});

describe("isEstimateDrifted", () => {
  it("flags anything more than 20% off the 1.0 baseline", () => {
    expect(isEstimateDrifted(1.4)).toBe(true);
    expect(isEstimateDrifted(0.6)).toBe(true);
    expect(isEstimateDrifted(1.1)).toBe(false);
    expect(isEstimateDrifted(1.0)).toBe(false);
  });
});

describe("formatEstimateDriftMessage", () => {
  it("matches the spec's own example shape", () => {
    expect(formatEstimateDriftMessage("coursework", 1.4)).toBe("You usually run 1.4× on coursework.");
  });
});
