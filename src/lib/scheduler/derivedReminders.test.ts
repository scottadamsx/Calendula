import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  formatCadenceReminderTitle,
  formatActivityHoldReminderTitle,
  formatMeetingFollowUpTitle,
  formatHabitShortfallReminderTitle,
  formatTaskAtRiskReminderTitle,
  nextFridayMorning,
} from "./derivedReminders";

const zone = "America/St_Johns";

describe("formatCadenceReminderTitle (spec §10.7's own example)", () => {
  it("matches 'Three weeks since Nick' exactly at 21 days", () => {
    expect(formatCadenceReminderTitle("Nick", 21)).toBe("Three weeks since Nick");
  });

  it("falls back to days under a week", () => {
    expect(formatCadenceReminderTitle("Nick", 3)).toBe("Three days since Nick");
  });
});

describe("formatActivityHoldReminderTitle", () => {
  it("names the activity type", () => {
    expect(formatActivityHoldReminderTitle("Camping")).toBe("Book Camping");
  });
});

describe("formatMeetingFollowUpTitle (spec §10.7's own example)", () => {
  it("matches 'Erin hasn't replied' for a single person", () => {
    expect(formatMeetingFollowUpTitle(["Erin"], "social")).toBe("Erin hasn't replied — follow up?");
  });

  it("is honest with no named person", () => {
    expect(formatMeetingFollowUpTitle([], "work")).toContain("Nobody's replied");
  });
});

describe("formatHabitShortfallReminderTitle (spec §10.7's own example)", () => {
  it("matches 'Gym is one short this week'", () => {
    expect(formatHabitShortfallReminderTitle("Gym", 1)).toBe("Gym is one short this week");
  });
});

describe("formatTaskAtRiskReminderTitle (spec §10.7's own example)", () => {
  it("matches 'CP assignment is tight — start today'", () => {
    expect(formatTaskAtRiskReminderTitle("CP assignment")).toBe("CP assignment is tight — start today");
  });
});

describe("nextFridayMorning (spec §10.7 — habit shortfall fires 'Friday morning')", () => {
  it("picks the upcoming Friday at 9am when today isn't Friday", () => {
    const monday = DateTime.fromObject({ year: 2026, month: 9, day: 14, hour: 10 }, { zone }).toJSDate(); // a Monday
    const result = DateTime.fromJSDate(nextFridayMorning(monday, zone), { zone });
    expect(result.weekday).toBe(5);
    expect(result.day).toBe(18);
    expect(result.hour).toBe(9);
  });

  it("rolls to next week if it's already past 9am on Friday", () => {
    const fridayAfternoon = DateTime.fromObject({ year: 2026, month: 9, day: 18, hour: 14 }, { zone }).toJSDate();
    const result = DateTime.fromJSDate(nextFridayMorning(fridayAfternoon, zone), { zone });
    expect(result.day).toBe(25);
  });

  it("stays on today if it's Friday before 9am", () => {
    const fridayMorning = DateTime.fromObject({ year: 2026, month: 9, day: 18, hour: 6 }, { zone }).toJSDate();
    const result = DateTime.fromJSDate(nextFridayMorning(fridayMorning, zone), { zone });
    expect(result.day).toBe(18);
    expect(result.hour).toBe(9);
  });
});
