import { DateTime } from "luxon";
import { computeGrid, type Block, type MergedPlacement, type PlacementInput, type EnergyWindowInput } from "@/lib/scheduler/grid";
import { solveCore, type TaskInput, type PlacedChunk } from "@/lib/scheduler/solveCore";
import { auditSchedule } from "./scheduleAudit";

export interface SchedulerScore {
  name: string;
  invariantPassRate: number;
  deadlinesMetRate: number;
  avgSlackHours: number;
  avgChunksPerTask: number;
  goodEnergyRate: number;
  dailyCapRate: number;
  unplacedMinutesRate: number;
}
export interface BenchmarkSummary {
  ranAt: string;
  weeks: number;
  seed: number;
  schedulers: SchedulerScore[];
}

const TZ = "America/St_Johns";
const PROFILE = { sleepStart: "23:00", sleepEnd: "07:00", blockMinutes: 15, maxTaskMinutesPerDay: 240, minBreakMinutes: 15 };

/** Deterministic PRNG so a benchmark run is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticWeek {
  from: Date;
  to: Date;
  placements: PlacementInput[];
  energyWindows: EnergyWindowInput[];
  tasks: TaskInput[];
}

export function generateWeek(random: () => number, index: number): SyntheticWeek {
  const monday = DateTime.fromObject({ year: 2026, month: 9, day: 14 }, { zone: TZ }).plus({ weeks: index % 8 });
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const placements: PlacementInput[] = [];
  const block = (day: number, h1: number, h2: number, title: string) =>
    placements.push({ sourceId: `${title}-${day}`, sourceType: "fixed", title, startsAt: monday.plus({ days: day, hours: h1 }).toJSDate(), endsAt: monday.plus({ days: day, hours: h2 }).toJSDate(), hardness: "hard", pinned: true, location: null, travelBufferMinutes: 0 });
  if (random() < 0.7) for (let d = 0; d < 5; d++) block(d, 9, 17, "Work");
  for (let i = 0; i < int(2, 5); i++) {
    const d = int(0, 6);
    const start = int(8, 19);
    const taken = placements.some((p) => p.startsAt < monday.plus({ days: d, hours: start + 2 }).toJSDate() && p.endsAt > monday.plus({ days: d, hours: start }).toJSDate());
    if (!taken) block(d, start, start + int(1, 2), `Appt${i}`);
  }
  const energyWindows: EnergyWindowInput[] = [];
  for (let i = 0; i < int(1, 2); i++) {
    const s = int(7, 18);
    energyWindows.push({ dayOfWeek: null, startTime: `${String(s).padStart(2, "0")}:00`, endTime: `${String(s + 3).padStart(2, "0")}:00`, quality: 0.9, label: "deep" });
  }
  const tasks: TaskInput[] = [];
  for (let i = 0; i < int(4, 8); i++) {
    tasks.push({
      id: `task-${i}`,
      categoryId: null,
      title: `Task ${i}`,
      remainingMinutes: int(2, 16) * 15,
      deadline: monday.plus({ days: int(1, 6), hours: int(9, 21) }).toJSDate(),
      priority: int(1, 5),
      minChunkMinutes: 30,
      maxChunkMinutes: 120,
      splittable: true,
      preferredLabels: [],
    });
  }
  return { from: monday.toJSDate(), to: monday.plus({ days: 7 }).toJSDate(), placements, energyWindows, tasks };
}

function gridFor(week: SyntheticWeek): Block[] {
  return computeGrid({ from: week.from, to: week.to, now: week.from, timezone: TZ, blockMinutes: PROFILE.blockMinutes, sleepStart: PROFILE.sleepStart, sleepEnd: PROFILE.sleepEnd, freezeWindowHours: 0, placements: week.placements, energyWindows: week.energyWindows });
}

/** Earliest-gap-wins: what a person does by hand. Respects commitments and sleep, nothing else. */
function fillFirstFit(blocks: Block[], tasks: TaskInput[]): PlacedChunk[] {
  const out: PlacedChunk[] = [];
  for (const t of tasks) {
    let remaining = t.remainingMinutes;
    for (const b of blocks) {
      if (remaining <= 0) break;
      if (b.state !== "free") continue;
      b.state = "soft";
      const last = out[out.length - 1];
      if (last && last.taskId === t.id && last.end.getTime() === b.start.getTime()) last.end = b.end;
      else out.push({ taskId: t.id, start: b.start, end: b.end });
      remaining -= (b.end.getTime() - b.start.getTime()) / 60_000;
    }
  }
  return out;
}

type Scheduler = (week: SyntheticWeek) => { chunks: PlacedChunk[]; blocks: Block[] };
export const SCHEDULERS: Record<string, Scheduler> = {
  Calendula: (week) => {
    const blocks = gridFor(week);
    const r = solveCore({ now: week.from, timezone: TZ, blocks, tasks: week.tasks, previousByTaskId: new Map(), calibrationByCategory: new Map(), maxTaskMinutesPerDay: PROFILE.maxTaskMinutesPerDay, minBreakMinutes: PROFILE.minBreakMinutes, movementPenalty: 0 });
    return { chunks: r.placements, blocks };
  },
  "First fit": (week) => {
    const blocks = gridFor(week);
    return { chunks: fillFirstFit(blocks, week.tasks), blocks };
  },
  "Deadline greedy": (week) => {
    const blocks = gridFor(week);
    const sorted = [...week.tasks].sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity));
    return { chunks: fillFirstFit(blocks, sorted), blocks };
  },
};

function mergeChunks(chunks: PlacedChunk[], tasks: TaskInput[]): MergedPlacement[] {
  const sorted = [...chunks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: MergedPlacement[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.sourceId === c.taskId && last.end.getTime() === c.start.getTime()) last.end = c.end;
    else merged.push({ sourceId: c.taskId, sourceType: "task", title: tasks.find((t) => t.id === c.taskId)!.title, start: c.start, end: c.end, state: "soft" });
  }
  return merged;
}

export function runBenchmark(weeks: number, seed = 42): BenchmarkSummary {
  const random = rng(seed);
  const generated = Array.from({ length: weeks }, (_, i) => generateWeek(random, i));
  const schedulers: SchedulerScore[] = [];
  for (const [name, run] of Object.entries(SCHEDULERS)) {
    let allInvariants = 0, capOk = 0, deadlinesMet = 0, deadlineTasks = 0, slackSum = 0, slackN = 0, chunkSum = 0, chunkN = 0, goodEnergy = 0, energyN = 0, unplaced = 0, totalMinutes = 0;
    for (const week of generated) {
      const { chunks, blocks } = run(week);
      const hard: MergedPlacement[] = week.placements.map((p) => ({ sourceId: p.sourceId, sourceType: "fixed", title: p.title, start: p.startsAt, end: p.endsAt, state: "hard" }));
      const soft = mergeChunks(chunks, week.tasks);
      const report = auditSchedule({ from: week.from, to: week.to, blocks, placements: [...hard, ...soft], tasks: week.tasks.map((t) => ({ id: t.id, title: t.title, deadline: t.deadline, remainingMinutes: t.remainingMinutes })), habits: [], profile: { timezone: TZ, sleepStart: PROFILE.sleepStart, sleepEnd: PROFILE.sleepEnd, maxTaskMinutesPerDay: PROFILE.maxTaskMinutesPerDay } });
      if (report.passed === report.invariants.length) allInvariants++;
      if (report.invariants.find((i) => i.id === "daily-cap")!.pass) capOk++;
      for (const t of week.tasks) {
        totalMinutes += t.remainingMinutes;
        const mine = soft.filter((p) => p.sourceId === t.id);
        const placed = mine.reduce((a, p) => a + (p.end.getTime() - p.start.getTime()) / 60_000, 0);
        unplaced += Math.max(0, t.remainingMinutes - placed);
        if (t.deadline) {
          deadlineTasks++;
          const lastEnd = mine.length ? Math.max(...mine.map((p) => p.end.getTime())) : null;
          if (lastEnd !== null && placed >= t.remainingMinutes && lastEnd <= t.deadline.getTime()) {
            deadlinesMet++;
            slackSum += (t.deadline.getTime() - lastEnd) / 3_600_000;
            slackN++;
          }
        }
        if (mine.length) { chunkSum += mine.length; chunkN++; }
      }
      for (const b of blocks) if (b.state === "soft" && b.sourceType !== "habit") { energyN++; if (b.quality >= 0.7) goodEnergy++; }
    }
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    schedulers.push({
      name,
      invariantPassRate: pct(allInvariants, weeks),
      deadlinesMetRate: pct(deadlinesMet, deadlineTasks),
      avgSlackHours: slackN ? Math.round((slackSum / slackN) * 10) / 10 : 0,
      avgChunksPerTask: chunkN ? Math.round((chunkSum / chunkN) * 100) / 100 : 0,
      goodEnergyRate: pct(goodEnergy, energyN),
      dailyCapRate: pct(capOk, weeks),
      unplacedMinutesRate: pct(unplaced, totalMinutes),
    });
  }
  return { ranAt: new Date().toISOString(), weeks, seed, schedulers };
}
