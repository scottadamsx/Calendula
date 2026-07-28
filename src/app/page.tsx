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
  },
  {
    id: "phase-1",
    name: "Phase 1 — Week view",
    detail: "Shows your fixed commitments (classes, shifts, appointments) on a week grid. Nothing gets scheduled automatically yet — that's next.",
  },
];

const UPCOMING_PHASES = [
  {
    name: "Phase 2 — Auto-scheduling your to-do list",
    status: "next" as const,
    detail: "Automatically finds time for tasks based on their deadlines, fitting them into your actual free time.",
  },
  {
    name: "Phase 3 — Habits",
    status: "later" as const,
    detail: "Schedules recurring things like the gym or practice, spaced out so they don't all land on the same day.",
  },
  {
    name: "Phase 4 — \"When are you free?\"",
    status: "later" as const,
    detail: "Suggests real meeting times when someone asks, without double-booking you or backfilling the slot overnight.",
  },
  {
    name: "Phase 4.5 — Smart reminders",
    status: "later" as const,
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
        lead="The first two pieces are built: the plumbing, and a week view of your fixed commitments. Nothing schedules itself automatically yet — that starts with Phase 2. Click a phase below to try it yourself and say whether it actually works."
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
