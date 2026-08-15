import { DateTime } from "luxon";

/** Pure title formatting for spec §10.7's derived reminders — matches the spec's own example phrasing. */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function numberWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** spec §10.7's own example: "Three weeks since Nick." */
export function formatCadenceReminderTitle(personName: string, daysSince: number): string {
  const weeks = Math.floor(daysSince / 7);
  const timeSince = weeks >= 1 ? `${capitalize(numberWord(weeks))} week${weeks === 1 ? "" : "s"}` : `${capitalize(numberWord(daysSince))} day${daysSince === 1 ? "" : "s"}`;
  return `${timeSince} since ${personName}`;
}

/**
 * spec's own example is "Book Butter Pot for camping" — "Butter Pot" is a
 * specific place name with no field to hold it (`activity_holds` has no
 * location column). Uses the activity type's own name instead of
 * fabricating a venue the data model can't actually carry.
 */
export function formatActivityHoldReminderTitle(activityTypeName: string): string {
  return `Book ${activityTypeName}`;
}

export function formatMeetingFollowUpTitle(personNames: string[], meetingType: string): string {
  if (personNames.length === 0) return `Nobody's replied to your ${meetingType} offer yet — follow up?`;
  const joined = personNames.length === 1 ? personNames[0] : `${personNames.slice(0, -1).join(", ")} and ${personNames[personNames.length - 1]}`;
  return `${joined} hasn't replied — follow up?`;
}

/** spec's own example: "Gym is one short this week." */
export function formatHabitShortfallReminderTitle(habitTitle: string, missing: number): string {
  return `${habitTitle} is ${numberWord(missing)} short this week`;
}

/** spec's own example: "CP assignment is tight — start today." */
export function formatTaskAtRiskReminderTitle(taskTitle: string): string {
  return `${taskTitle} is tight — start today`;
}

/** spec §10.7: habit-shortfall reminders fire "Friday morning" — the next one, 9am local. */
export function nextFridayMorning(now: Date, timezone: string): Date {
  const dt = DateTime.fromJSDate(now, { zone: timezone });
  const daysUntilFriday = (5 - dt.weekday + 7) % 7;
  let candidate = dt.plus({ days: daysUntilFriday }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  if (candidate <= dt) candidate = candidate.plus({ days: 7 });
  return candidate.toJSDate();
}
