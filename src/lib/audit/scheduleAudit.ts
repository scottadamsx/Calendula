import { DateTime } from "luxon";
import type { Block, MergedPlacement } from "@/lib/scheduler/grid";

export interface AuditTask {
  id: string;
  title: string;
  deadline: Date | null;
  remainingMinutes: number;
}
export interface AuditHabit {
  id: string;
  title: string;
  targetSessionsPerWeek: number;
  minSpacingHours: number;
}
export interface AuditProfile {
  timezone: string;
  sleepStart: string; // HH:mm
  sleepEnd: string; // HH:mm
  maxTaskMinutesPerDay: number;
}
export interface AuditInput {
  from: Date;
  to: Date;
  blocks: Block[];
  placements: MergedPlacement[];
  tasks: AuditTask[];
  habits: AuditHabit[];
  profile: AuditProfile;
}

export interface Invariant {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface AuditReport {
  invariants: Invariant[];
  passed: number;
  metrics: {
    scheduledTaskHours: number;
    scheduledHabitSessions: number;
    freeHours: number;
    largestFreeBlockByDay: { day: string; minutes: number }[];
    taskSlack: { title: string; slackHours: number | null; chunks: number }[];
    habitAdherence: { title: string; sessions: number; target: number }[];
    minSlackHours: number | null;
    avgChunksPerTask: number | null;
    taskMinutesInGoodEnergy: number | null;
  };
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

function minutesInSleep(p: { start: Date; end: Date }, profile: AuditProfile): number {
  const [ssH, ssM] = profile.sleepStart.split(":").map(Number);
  const [seH, seM] = profile.sleepEnd.split(":").map(Number);
  let total = 0;
  let cursor = DateTime.fromJSDate(p.start, { zone: profile.timezone });
  const end = DateTime.fromJSDate(p.end, { zone: profile.timezone });
  while (cursor < end) {
    const m = cursor.hour * 60 + cursor.minute;
    const s = ssH * 60 + ssM;
    const e = seH * 60 + seM;
    const asleep = s > e ? m >= s || m < e : m >= s && m < e;
    if (asleep) total += 1;
    cursor = cursor.plus({ minutes: 1 });
  }
  return total;
}

/**
 * The math behind "does the auto-scheduling stack up." Six invariants that
 * must hold on every week the solver produces (any failure is a solver bug,
 * not a preference), plus quality metrics that make a good week comparable
 * to a worse one. Pure: give it a week's grid and rows, get a report.
 */
export function auditSchedule(input: AuditInput): AuditReport {
  const { blocks, placements, tasks, habits, profile } = input;
  const tz = profile.timezone;
  const soft = placements.filter((p) => p.state === "soft");
  const hard = placements.filter((p) => p.state === "hard");
  const softTasks = soft.filter((p) => p.sourceType === "task");
  const softHabits = soft.filter((p) => p.sourceType === "habit");
  const invariants: Invariant[] = [];

  // I1: no two placements overlap
  const collisions: string[] = [];
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      if (overlaps(placements[i], placements[j])) collisions.push(`${placements[i].title} × ${placements[j].title}`);
  invariants.push({ id: "no-overlap", label: "No two blocks overlap", pass: collisions.length === 0, detail: collisions.length ? collisions.slice(0, 3).join("; ") : `${placements.length} blocks checked pairwise` });

  // I2: scheduled work never lands on a commitment
  const onCommitment = softTasks.concat(softHabits).filter((s) => hard.some((h) => overlaps(s, h)));
  invariants.push({ id: "respects-commitments", label: "Scheduled work never sits on a commitment", pass: onCommitment.length === 0, detail: onCommitment.length ? onCommitment.map((p) => p.title).join(", ") : `${soft.length} scheduled blocks vs ${hard.length} commitments` });

  // I3: nothing scheduled during sleep
  const inSleep = soft.filter((p) => minutesInSleep(p, profile) > 0);
  invariants.push({ id: "respects-sleep", label: "Nothing scheduled during sleep", pass: inSleep.length === 0, detail: inSleep.length ? inSleep.map((p) => p.title).join(", ") : `sleep ${profile.sleepStart}–${profile.sleepEnd}` });

  // I4: every task with remaining work and a deadline in range finishes before it
  const late: string[] = [];
  const taskSlack: AuditReport["metrics"]["taskSlack"] = [];
  for (const t of tasks) {
    const chunks = softTasks.filter((p) => p.sourceId === t.id);
    const lastEnd = chunks.length ? new Date(Math.max(...chunks.map((c) => c.end.getTime()))) : null;
    const slackHours = t.deadline && lastEnd ? Math.round(((t.deadline.getTime() - lastEnd.getTime()) / 3_600_000) * 10) / 10 : null;
    const dueThisWeek = t.deadline !== null && t.deadline >= input.from && t.deadline < input.to;
    if (chunks.length || (t.remainingMinutes > 0 && dueThisWeek)) taskSlack.push({ title: t.title, slackHours, chunks: chunks.length });
    if (t.deadline && lastEnd && lastEnd > t.deadline) late.push(t.title);
  }
  invariants.push({ id: "before-deadline", label: "Every scheduled task finishes before its deadline", pass: late.length === 0, detail: late.length ? late.join(", ") : `${taskSlack.filter((t) => t.chunks > 0).length} tasks scheduled` });

  // I5: habit sessions keep their minimum spacing
  const tooClose: string[] = [];
  const habitAdherence: AuditReport["metrics"]["habitAdherence"] = [];
  for (const h of habits) {
    const sessions = softHabits.filter((p) => p.sourceId === h.id).sort((a, b) => a.start.getTime() - b.start.getTime());
    habitAdherence.push({ title: h.title, sessions: sessions.length, target: h.targetSessionsPerWeek });
    for (let i = 1; i < sessions.length; i++) {
      const gapH = (sessions[i].start.getTime() - sessions[i - 1].end.getTime()) / 3_600_000;
      if (gapH < h.minSpacingHours) tooClose.push(`${h.title} (${Math.round(gapH)}h apart, needs ${h.minSpacingHours}h)`);
    }
  }
  invariants.push({ id: "habit-spacing", label: "Habit sessions keep their minimum spacing", pass: tooClose.length === 0, detail: tooClose.length ? tooClose.join("; ") : `${softHabits.length} sessions across ${habits.length} habits` });

  // I6: daily task cap
  const byDay = new Map<string, number>();
  for (const p of softTasks) {
    const key = DateTime.fromJSDate(p.start, { zone: tz }).toISODate()!;
    byDay.set(key, (byDay.get(key) ?? 0) + (p.end.getTime() - p.start.getTime()) / 60_000);
  }
  const overCap = [...byDay.entries()].filter(([, m]) => m > profile.maxTaskMinutesPerDay);
  invariants.push({ id: "daily-cap", label: `No day exceeds the task cap (${profile.maxTaskMinutesPerDay} min)`, pass: overCap.length === 0, detail: overCap.length ? overCap.map(([d, m]) => `${d}: ${m} min`).join(", ") : `busiest day ${Math.max(0, ...byDay.values())} min` });

  // Metrics: free time from the grid itself
  const freeByDay = new Map<string, number>();
  const largest = new Map<string, number>();
  let run = 0;
  let runDay = "";
  for (const b of blocks) {
    const day = DateTime.fromJSDate(b.start, { zone: tz }).toISODate()!;
    if (b.state === "free") {
      const minutes = (b.end.getTime() - b.start.getTime()) / 60_000;
      freeByDay.set(day, (freeByDay.get(day) ?? 0) + minutes);
      run = runDay === day ? run + minutes : minutes;
      runDay = day;
      largest.set(day, Math.max(largest.get(day) ?? 0, run));
    } else {
      run = 0;
    }
  }
  const freeMinutes = [...freeByDay.values()].reduce((a, b) => a + b, 0);
  const goodEnergyBlocks = blocks.filter((b) => b.state === "soft" && b.sourceType === "task");
  const goodEnergy = goodEnergyBlocks.length ? goodEnergyBlocks.filter((b) => b.quality >= 0.7).length / goodEnergyBlocks.length : null;
  const slacks = taskSlack.map((t) => t.slackHours).filter((x): x is number => x !== null);
  const chunked = taskSlack.filter((t) => t.chunks > 0);

  return {
    invariants,
    passed: invariants.filter((i) => i.pass).length,
    metrics: {
      scheduledTaskHours: Math.round((softTasks.reduce((a, p) => a + (p.end.getTime() - p.start.getTime()), 0) / 3_600_000) * 10) / 10,
      scheduledHabitSessions: softHabits.length,
      freeHours: Math.round((freeMinutes / 60) * 10) / 10,
      largestFreeBlockByDay: [...largest.entries()].map(([day, minutes]) => ({ day: DateTime.fromISO(day, { zone: tz }).toFormat("ccc"), minutes })),
      taskSlack,
      habitAdherence,
      minSlackHours: slacks.length ? Math.min(...slacks) : null,
      avgChunksPerTask: chunked.length ? Math.round((chunked.reduce((a, t) => a + t.chunks, 0) / chunked.length) * 10) / 10 : null,
      taskMinutesInGoodEnergy: goodEnergy === null ? null : Math.round(goodEnergy * 100),
    },
  };
}
