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
];

const UPCOMING_PHASES = [
  {
    name: "Phase 4.5 — Smart reminders",
    status: "next" as const,
    detail: "Nudges you about things at the right moment instead of bombarding you with notifications.",
  },
  {
    name: "Phase 5 — Planning ahead",
    status: "later" as const,
    detail: "Helps you plan and protect multi-day trips or events weeks or months in advance.",
  },
  {
    name: "Phase 6 — Daily summary",
    status: "later" as const,
    detail: "A daily written summary of what's going on, and learning from how long things actually take you.",
  },
  {
    name: "Phase 7 — Google Calendar import",
    status: "later" as const,
    detail: "Pulls your existing Google Calendar events in automatically. One-way only — never edits Google Calendar itself.",
  },
];

const STATUS_LABEL: Record<
  (typeof UPCOMING_PHASES)[number]["status"],
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
        eyebrow="Overview"
        title="Calendula is under construction"
        lead="Five pieces are built: the plumbing, a week view, auto-scheduling for your to-do list, habits, and finding meeting times. Reminders and beyond are still ahead. Click a phase below to try it yourself and say whether it actually works."
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
