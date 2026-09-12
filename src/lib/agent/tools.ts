import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { createTask } from "@/app/actions/tasks";
import { createHabit } from "@/app/actions/habits";
import { createFixedBlock } from "@/app/actions/fixedBlocks";
import { createReminder } from "@/app/actions/reminders";
import { deleteCalendarItem, type DeletableKind } from "@/app/actions/deleteItems";
import { updateCalendarItem, type UpdatePatch } from "@/app/actions/updateItems";
import { buildGrid } from "@/lib/scheduler/buildGrid";
import { mergeBySource } from "@/lib/scheduler/grid";
import { createClient } from "@/lib/supabase/server";

/**
 * The chat agent's tools — spec §13 only ever named a one-shot `POST
 * /api/ingest` (never built, same ANTHROPIC_API_KEY gate as everything
 * else), not a multi-turn conversational surface; this is genuinely new.
 * Every "write" tool builds a FormData object and calls the *exact* server
 * action the form UI already uses (`createTask`, `createHabit`,
 * `createFixedBlock`, `createReminder`) rather than reimplementing their
 * logic — same validation, same conflict guard, same re-solve triggers,
 * zero duplicated code. Those actions resolve the signed-in user from the
 * request's own cookies (`createClient()` + `auth.getUser()`), which works
 * here unchanged since the chat's server action runs in the same
 * authenticated request context.
 *
 * Datetimes: the model is instructed (system prompt, chat.ts) to emit
 * plain "YYYY-MM-DDTHH:mm" local time with no offset — exactly what a
 * `datetime-local` form input sends. This matches the existing forms'
 * behavior exactly rather than introducing a second, different date
 * convention; if that plain-local parsing has an edge case, it already
 * equally affects the form UI and isn't specific to the chat surface.
 */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_task",
    description:
      "Add a to-do item with a deadline. The scheduler automatically finds time for it before the deadline — never ask the user which exact time slot, that's the scheduler's job.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        estimatedMinutes: { type: "integer", minimum: 5 },
        deadline: {
          type: "string",
          description: "Local datetime YYYY-MM-DDTHH:mm. Omit if there's genuinely no deadline.",
        },
        priority: { type: "integer", minimum: 1, maximum: 5, description: "1 = lowest, 5 = highest. Default 3." },
      },
      required: ["title", "estimatedMinutes"],
    },
  },
  {
    name: "create_habit",
    description: "Add a recurring habit (e.g. the gym) that the scheduler places multiple times a week, spaced apart automatically.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        durationMinutes: { type: "integer", minimum: 5 },
        targetSessionsPerWeek: { type: "integer", minimum: 1, maximum: 7 },
        minSpacingHours: { type: "integer", minimum: 0, description: "Minimum hours between sessions. Default 24." },
        earliestTime: { type: "string", description: "HH:mm, earliest time of day it can start." },
        latestTime: { type: "string", description: "HH:mm, latest time of day it can end." },
      },
      required: ["title", "durationMinutes", "targetSessionsPerWeek"],
    },
  },
  {
    name: "create_fixed_block",
    description:
      "Add a fixed commitment (class, shift, appointment) that the scheduler never moves. If it overlaps something that already exists, this will fail with a specific conflict message — tell the user and ask what they'd like to do instead of guessing a new time yourself.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startsAt: { type: "string", description: "Local datetime YYYY-MM-DDTHH:mm of the first/only occurrence." },
        endsAt: { type: "string", description: "Local datetime YYYY-MM-DDTHH:mm it ends." },
        location: { type: "string" },
        repeatsOnDays: {
          type: "array",
          items: { type: "string", enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] },
          description: "Weekdays it repeats on every week (e.g. work Mon-Fri: [\"MO\",\"TU\",\"WE\",\"TH\",\"FR\"]). Omit for a one-off.",
        },
      },
      required: ["title", "startsAt", "endsAt"],
    },
  },
  {
    name: "create_reminder",
    description:
      "Add a reminder — a nudge, not scheduled work. 'moment' fires by a specific time, 'window' fires sometime in a range, 'latent' has no time pressure and only surfaces when relevant later.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["moment", "window", "latent"] },
        dueAt: { type: "string", description: "Local datetime YYYY-MM-DDTHH:mm — required for kind='moment'." },
        windowStart: { type: "string", description: "Local datetime YYYY-MM-DDTHH:mm — required for kind='window'." },
        windowEnd: { type: "string", description: "Local datetime YYYY-MM-DDTHH:mm — required for kind='window'." },
        importance: { type: "integer", minimum: 1, maximum: 5, description: "Default 3." },
      },
      required: ["title", "kind"],
    },
  },
  {
    name: "get_week_overview",
    description: "Look at what's already scheduled for a given week — use this before scheduling something new if you need to check for conflicts or free time, rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        weekOffset: { type: "integer", description: "0 = this week, 1 = next week, etc. Default 0." },
      },
    },
  },
  {
    name: "list_calendar_items",
    description:
      "List everything on the user's calendar with its id: active tasks, active habits, fixed commitments (with their repeat days), and pending reminders. Call this before delete_calendar_item so you delete the right thing by id — never guess an id.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_calendar_item",
    description:
      "Permanently delete one task, habit, fixed commitment, or reminder by id (from list_calendar_items). Frees its time and re-solves the schedule. There is no edit tool — to change something, delete it and create it again with the new details. Only delete what the user clearly asked to remove; if it's ambiguous which one they mean, ask.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["task", "habit", "fixed_block", "reminder"] },
        id: { type: "string" },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "update_calendar_item",
    description:
      "Change an existing task, habit, fixed commitment, or reminder in place (new time, new days, new title, new duration, new deadline). Get the id from list_calendar_items first. Only send the fields that change. A fixed commitment is re-checked for overlaps; anything that affects the schedule is re-solved and the result says when things now land.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["task", "habit", "fixed_block", "reminder"] },
        id: { type: "string" },
        title: { type: "string" },
        startsAt: { type: "string", description: "fixed_block: local datetime YYYY-MM-DDTHH:mm of the (first) occurrence" },
        endsAt: { type: "string", description: "fixed_block: local datetime YYYY-MM-DDTHH:mm" },
        repeatsOnDays: { type: "array", items: { type: "string", enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] }, description: "fixed_block: full new list of weekdays; empty array = one-off" },
        location: { type: "string" },
        estimatedMinutes: { type: "integer", description: "task" },
        deadline: { type: "string", description: "task: local datetime, or empty string for no deadline" },
        priority: { type: "integer", minimum: 1, maximum: 5, description: "task" },
        durationMinutes: { type: "integer", description: "habit" },
        targetSessionsPerWeek: { type: "integer", description: "habit" },
        minSpacingHours: { type: "integer", description: "habit" },
        earliestTime: { type: "string", description: "habit: HH:mm" },
        latestTime: { type: "string", description: "habit: HH:mm" },
        reminderKind: { type: "string", enum: ["moment", "window", "latent"], description: "reminder" },
        dueAt: { type: "string", description: "reminder: local datetime" },
        windowStart: { type: "string", description: "reminder: local datetime" },
        windowEnd: { type: "string", description: "reminder: local datetime" },
        importance: { type: "integer", minimum: 1, maximum: 5, description: "reminder" },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "ask_multiple_choice",
    description:
      "Ask the user a multiple-choice question when you genuinely need more information before acting (an ambiguous time, confirming which of several things they mean). The conversation pauses until they pick an option — don't use this for things you can reasonably infer or that don't matter.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      },
      required: ["question", "options"],
    },
  },
];

export interface ToolContext {
  userId: string;
  timezone: string;
}

/**
 * `ask_multiple_choice` is deliberately not handled here — the orchestration
 * loop (chat.ts) intercepts it before execution and pauses the turn instead.
 */
export async function executeAgentTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (name) {
    case "create_task": {
      const fd = new FormData();
      fd.set("title", String(input.title ?? ""));
      fd.set("estimatedMinutes", String(input.estimatedMinutes ?? ""));
      if (input.deadline) fd.set("deadline", String(input.deadline));
      if (input.priority != null) fd.set("priority", String(input.priority));
      return JSON.stringify(await createTask(null, fd));
    }
    case "create_habit": {
      const fd = new FormData();
      fd.set("title", String(input.title ?? ""));
      fd.set("durationMinutes", String(input.durationMinutes ?? ""));
      fd.set("targetSessionsPerWeek", String(input.targetSessionsPerWeek ?? ""));
      if (input.minSpacingHours != null) fd.set("minSpacingHours", String(input.minSpacingHours));
      if (input.earliestTime) fd.set("earliestTime", String(input.earliestTime));
      if (input.latestTime) fd.set("latestTime", String(input.latestTime));
      return JSON.stringify(await createHabit(null, fd));
    }
    case "create_fixed_block": {
      const fd = new FormData();
      fd.set("title", String(input.title ?? ""));
      fd.set("startsAt", String(input.startsAt ?? ""));
      fd.set("endsAt", String(input.endsAt ?? ""));
      if (input.location) fd.set("location", String(input.location));
      const days = Array.isArray(input.repeatsOnDays) ? input.repeatsOnDays : [];
      for (const day of days) fd.append("repeatsOnDays", String(day));
      return JSON.stringify(await createFixedBlock(null, fd));
    }
    case "create_reminder": {
      const fd = new FormData();
      fd.set("title", String(input.title ?? ""));
      fd.set("kind", String(input.kind ?? "moment"));
      if (input.importance != null) fd.set("importance", String(input.importance));
      if (input.dueAt) fd.set("dueAt", String(input.dueAt));
      if (input.windowStart) fd.set("windowStart", String(input.windowStart));
      if (input.windowEnd) fd.set("windowEnd", String(input.windowEnd));
      return JSON.stringify(await createReminder(null, fd));
    }
    case "get_week_overview": {
      const weekOffset = typeof input.weekOffset === "number" ? input.weekOffset : 0;
      const weekStart = DateTime.now().setZone(ctx.timezone).startOf("week").plus({ weeks: weekOffset });
      const weekEnd = weekStart.plus({ days: 7 });
      const blocks = await buildGrid(ctx.userId, weekStart.toJSDate(), weekEnd.toJSDate());
      const merged = mergeBySource(blocks);
      const items = merged.map((p) => ({
        title: p.title,
        type: p.sourceType,
        hardness: p.state,
        start: DateTime.fromJSDate(p.start, { zone: ctx.timezone }).toFormat("ccc LLL d, h:mma"),
        end: DateTime.fromJSDate(p.end, { zone: ctx.timezone }).toFormat("h:mma"),
      }));
      // Free time per day, so "what should I do Wednesday evening" is grounded
      // in actual gaps rather than guessed from the list of busy items.
      const freeByDay = new Map<string, { runs: string[]; totalMinutes: number }>();
      let run: { start: Date; end: Date } | null = null;
      const flush = () => {
        if (!run) return;
        const minutes = (run.end.getTime() - run.start.getTime()) / 60_000;
        if (minutes >= 30) {
          const s = DateTime.fromJSDate(run.start, { zone: ctx.timezone });
          const e = DateTime.fromJSDate(run.end, { zone: ctx.timezone });
          const key = s.toFormat("ccc LLL d");
          const entry = freeByDay.get(key) ?? { runs: [], totalMinutes: 0 };
          entry.runs.push(`${s.toFormat("h:mma")}–${e.toFormat("h:mma")}`);
          entry.totalMinutes += minutes;
          freeByDay.set(key, entry);
        }
        run = null;
      };
      for (const b of blocks) {
        if (b.state === "free" && b.start >= new Date()) {
          if (run && run.end.getTime() === b.start.getTime()) run.end = b.end;
          else { flush(); run = { start: b.start, end: b.end }; }
        } else flush();
      }
      flush();
      const freeTime = [...freeByDay.entries()].map(([day, v]) => ({ day, free: v.runs, totalFreeHours: Math.round(v.totalMinutes / 6) / 10 }));
      return JSON.stringify({ weekOf: weekStart.toFormat("LLL d, yyyy"), items, freeTime });
    }
    case "list_calendar_items": {
      const supabase = await createClient();
      const [tasks, habits, blocks, reminders] = await Promise.all([
        supabase.from("calendula_tasks").select("id, title, remaining_minutes, deadline, priority").eq("user_id", ctx.userId).eq("status", "active"),
        supabase.from("calendula_habits").select("id, title, duration_minutes, target_sessions_per_week").eq("user_id", ctx.userId).eq("active", true),
        supabase.from("calendula_fixed_blocks").select("id, title, starts_at, ends_at, rrule, location").eq("user_id", ctx.userId),
        supabase.from("calendula_reminders").select("id, title, kind, due_at, window_start, window_end").eq("user_id", ctx.userId).eq("status", "pending"),
      ]);
      const local = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone: ctx.timezone }).toFormat("ccc LLL d yyyy, h:mma") : null);
      return JSON.stringify({
        tasks: (tasks.data ?? []).map((t) => ({ id: t.id, title: t.title, remainingMinutes: t.remaining_minutes, deadline: local(t.deadline), priority: t.priority })),
        habits: (habits.data ?? []).map((h) => ({ id: h.id, title: h.title, durationMinutes: h.duration_minutes, sessionsPerWeek: h.target_sessions_per_week })),
        fixedBlocks: (blocks.data ?? []).map((b) => ({
          id: b.id,
          title: b.title,
          firstStart: local(b.starts_at),
          firstEnd: local(b.ends_at),
          repeats: b.rrule ? b.rrule.replace("FREQ=WEEKLY;BYDAY=", "weekly on ") : null,
          location: b.location,
        })),
        reminders: (reminders.data ?? []).map((r) => ({ id: r.id, title: r.title, kind: r.kind, dueAt: local(r.due_at), windowStart: local(r.window_start), windowEnd: local(r.window_end) })),
      });
    }
    case "update_calendar_item": {
      const { kind, id, ...patch } = input as unknown as { kind: DeletableKind; id: string } & UpdatePatch;
      return JSON.stringify(await updateCalendarItem(kind, String(id ?? ""), patch));
    }
    case "delete_calendar_item": {
      return JSON.stringify(await deleteCalendarItem(String(input.kind) as DeletableKind, String(input.id ?? "")));
    }
    default:
      return JSON.stringify({ ok: false, message: `Unknown tool: ${name}` });
  }
}
