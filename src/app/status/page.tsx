import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { PhaseRow } from "@/components/qa/PhaseRow";
import { CalendulaMark } from "@/components/brand/CalendulaMark";
import { readQaStatus, emptyPhaseState } from "@/lib/qa/store";
import { markPhaseVerified, reportPhaseBug, resolvePhaseBug } from "@/app/actions/qa";

const BUILT_PHASES = [
  {
    id: "phase-0",
    name: "Phase 0 — Foundation",
    detail: "The database, login, and visual design underneath everything else. Nothing to look at yet — this is the plumbing.",
    howToTest: [
      "Go to Settings.",
      "Check the Credentials list.",
      "Expected: all four Supabase values show \"Set,\" nothing shows an error.",
    ],
  },
  {
    id: "phase-1",
    name: "Phase 1 — Week view",
    detail: "Shows your fixed commitments (classes, shifts, appointments) on a week grid. Nothing gets scheduled automatically yet.",
    howToTest: [
      "Go to Week.",
      "Look for your classes/shifts/appointments (solid dark blocks).",
      "Expected: they show up on the correct day, at the correct time, with no crash.",
    ],
  },
  {
    id: "phase-2",
    name: "Phase 2 — Auto-scheduling your to-do list",
    detail: "Automatically finds time for tasks based on their deadlines, fitting them into your actual free time without double-booking anything.",
    howToTest: [
      "Go to Week.",
      "Use \"Add a task\" — title, a duration like 60 minutes, a deadline a few days out.",
      "Wait about 2 seconds (it batches changes before scheduling), then refresh the page.",
      "Expected: an orange block for that task appears sometime before its deadline, not overlapping anything else.",
      "To test a conflict: add a second task with the same tight deadline and a long duration, longer than the free time actually left before that deadline. Expected: the message says there wasn't room for it, and on refresh that task has no orange block at all — it should never overlap the other one.",
    ],
  },
  {
    id: "phase-3",
    name: "Phase 3 — Habits",
    detail: "Schedules recurring things like the gym or practice, spaced out so they don't all land on the same day.",
    howToTest: [
      "Go to Week.",
      "Use \"Add a habit\" — e.g. Gym, 60 minutes, 3 times/week, 24 hours minimum spacing.",
      "Wait a few seconds, then refresh.",
      "Expected: green blocks appear on different days, never less than 24 hours apart — never two days in a row.",
      "If the week genuinely has no room left, the message says how many sessions couldn't fit instead of silently dropping them.",
    ],
  },
  {
    id: "phase-4",
    name: "Phase 4 — \"When are you free?\"",
    detail: "Suggests real meeting times when someone asks, without double-booking you or letting something else fill the slot overnight.",
    howToTest: [
      "Go to Meetings.",
      "Use \"Find a time\" — a purpose, a duration like 60 minutes, and a horizon of a week.",
      "Expected: up to 3 slots come back, each on a different day, with a plain-English message you could paste into a text.",
      "Click Confirm on one of them.",
      "Expected: that slot turns into a real meeting on Week (dark block), and the other offered slots disappear instead of staying held.",
    ],
  },
  {
    id: "phase-4-5",
    name: "Phase 4.5 — Smart reminders",
    detail: "Nudges you about things at the right moment — never during sleep, never on top of something already pinned down, never after it's already too late.",
    howToTest: [
      "Go to Reminders.",
      "Use \"Add a reminder\" — kind \"Moment\", a title, and a due time about an hour and a half from now.",
      "It won't get a surface time immediately — that only happens on a solve or the 15-minute reminder cron. Go to Week and add any task (that triggers a solve), then go back to Reminders.",
      "Expected: it now shows a \"surfaces\" badge with a time before your due time — never after it.",
      "Add a second one with kind \"Someday\" (no due time) — expected: it shows a \"someday\" badge instead, never a surface time, and never uses up a budget slot.",
    ],
  },
  {
    id: "phase-4-6",
    name: "Phase 4.6 — Batching and outcome capture",
    detail: "Groups reminders that land close together into one digest instead of several separate nudges, and lets you act on one (done, seen, later, dismiss). Real push notifications are intentionally deferred — see below.",
    howToTest: [
      "Go to Reminders and add three reminders (kind \"Moment\") all with the same due time, a couple hours out — leave the page between each so all three save.",
      "Trigger a solve (add any task on Week), then go back to Reminders.",
      "Expected: the three collapse into one \"digest\" card with a single plain-English sentence naming all three, each still with its own Done/Seen/Later/Dismiss buttons.",
      "Click Dismiss on one.",
      "Expected: it drops out immediately and the other two stay grouped together.",
    ],
  },
  {
    id: "phase-5",
    name: "Phase 5 — Planning ahead",
    detail: "Finds and defends good multi-day windows for things like camping trips, months in advance — an empty weekend isn't a free weekend if coursework is about to land there.",
    howToTest: [
      "Go to Planning.",
      "Use \"Add an activity type\" — e.g. Camping, 48 hours minimum, requires overnight checked.",
      "Use \"Find a window\" — pick that activity, a horizon of 30-90 days.",
      "Expected: up to 3 day-range options come back, each at least a week apart, with a score and a load percentage.",
      "Click \"Hold this window\" on one.",
      "Expected: it moves into the \"Held\" list below, and a dark block for it appears on Week for those days. Click Release to undo it.",
    ],
  },
  {
    id: "phase-6",
    name: "Phase 6 — Advisor and reconciliation",
    detail: "Checks whether things actually happened the way they were scheduled, learns how long your work really takes, and surfaces what's overloaded or drifting. No ANTHROPIC_API_KEY configured, so this reads as plain deterministic text, not AI-polished prose — the facts underneath are real either way.",
    howToTest: [
      "Go to Check-in — anything the solver placed that's already passed shows up here. Log five or more as \"Different…\" with a consistently longer actual time than planned (e.g. planned 60, actual 90 each time).",
      "Expected: after five, a message on Advisor reads something like \"You usually run 1.5× on [category].\"",
      "Go to Advisor and use \"Add a person\" with a cadence of 1 day, leave it — expected: a drift line appears immediately (\"You and X are... out\").",
      "Click \"We talked today\" — expected: that line disappears.",
    ],
  },
  {
    id: "phase-6-5",
    name: "Phase 6.5 — Promotion loop and derived reminders",
    detail: "Notices when a recurring reminder is really a task in disguise, catches small tasks that keep getting skipped, and generates reminders automatically from other layers (like an upcoming camping trip or someone falling out of touch).",
    howToTest: [
      "Go to Reminders, add one, and defer it three times using the \"Later\" button (you may need to add any task on Week between each defer to trigger reassignment).",
      "Go to Advisor — expected: a \"Proposals\" section appears with the exact reminder title and \"Schedule 45 minutes for it?\"",
      "Click \"Schedule it\" — expected: it's now a real scheduled task instead of a reminder.",
      "Go to Planning, hold a window for any activity type, then release it.",
      "Expected: a \"Book [activity]\" reminder briefly exists (visible on Reminders if you check right after holding), and disappears once released.",
    ],
  },
];

const UPCOMING_PHASES = [
  {
    name: "Phase 7 — Google Calendar import",
    status: "next" as const,
    detail: "Pulls your existing Google Calendar events in automatically. One-way only — never edits Google Calendar itself. Partially built: the import/update/delete reconciliation logic is done and tested against real data, but it's blocked on a Google Cloud OAuth app — see Connectors for status.",
  },
];

const STATUS_LABEL: Record<
  "next" | "later",
  { label: string; tone: "info" | "neutral" }
> = {
  next: { label: "Next", tone: "info" },
  later: { label: "Not started", tone: "neutral" },
};

export default async function OverviewPage() {
  const qaStatus = await readQaStatus();

  return (
    <>
      <PageHeader
        eyebrow="Build status"
        title="Calendula is under construction"
        lead="Ten pieces are built: the plumbing, a week view, auto-scheduling for your to-do list, habits, finding meeting times, reminders, digest batching, defending time for future plans, reconciliation, and the promotion/demotion loop with derived reminders. Google Calendar import is next — real push notifications and AI-polished prose are intentionally deferred for now. Click a phase below to try it yourself and say whether it actually works. The Chat page is now the main space — this page is the engineering status board behind it."
        action={<CalendulaMark size={88} animated className="shrink-0" />}
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="text-base font-semibold mb-1">Built — needs your verification</h2>
          <p className="text-xs text-ink-soft mb-3">
            Click a phase to expand it, confirm it works, or log a bug. Reported bugs stay open
            until marked resolved — check back here after asking for a fix.
          </p>
          <ul>
            {BUILT_PHASES.map((phase) => (
              <PhaseRow
                key={phase.id}
                name={phase.name}
                detail={phase.detail}
                howToTest={phase.howToTest}
                qaState={qaStatus[phase.id] ?? emptyPhaseState()}
                markVerified={markPhaseVerified.bind(null, phase.id)}
                reportBug={reportPhaseBug.bind(null, phase.id)}
                resolveBug={resolvePhaseBug.bind(null, phase.id)}
              />
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-4">Upcoming</h2>
          <ul className="flex flex-col gap-3">
            {UPCOMING_PHASES.map((phase) => (
              <li
                key={phase.name}
                className="flex items-start justify-between gap-4 pb-3 border-b border-line last:border-0 last:pb-0"
              >
                <div>
                  <div className="text-sm font-medium text-ink">{phase.name}</div>
                  <div className="text-xs text-ink-soft mt-0.5">{phase.detail}</div>
                </div>
                <Badge tone={STATUS_LABEL[phase.status].tone}>
                  {STATUS_LABEL[phase.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
