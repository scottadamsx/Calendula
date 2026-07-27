import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { PhaseRow } from "@/components/qa/PhaseRow";
import { CalendulaMark } from "@/components/brand/CalendulaMark";
import { readQaStatus, emptyPhaseState } from "@/lib/qa/store";
import { markPhaseVerified, reportPhaseBug, resolvePhaseBug } from "@/app/actions/qa";

const BUILT_PHASES = [
  { id: "phase-0", name: "Phase 0 — Foundation", detail: "Schema, RLS, dispatcher stub, brand system, house style." },
  { id: "phase-1", name: "Phase 1 — Grid, read-only", detail: "buildGrid, week view rendering hard placements, DST-correct." },
];

const UPCOMING_PHASES = [
  { name: "Phase 2 — Task solver", status: "next" as const, detail: "Least-slack-time solver, movement penalty, freeze window." },
  { name: "Phase 3 — Habits", status: "later" as const, detail: "Second-pass placement, spacing constraints." },
  { name: "Phase 4 — Meeting offers", status: "later" as const, detail: "Displacement cost, tentative holds, expiry cron." },
  { name: "Phase 4.5 — Reminders core", status: "later" as const, detail: "Urgency, receptivity, attention budget." },
  { name: "Phase 5 — Future windows", status: "later" as const, detail: "Projected load, window scoring, defended holds." },
  { name: "Phase 6 — Advisor and reconciliation", status: "later" as const, detail: "Signal queries, daily brief, calibration." },
  { name: "Phase 7 — Google Calendar import", status: "later" as const, detail: "Read-only pull, deduplicated on external_id." },
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
        lead="Phases 0 and 1 are built. Built doesn't mean verified — click a phase below to confirm it works yourself, or report what's broken. No auto-scheduling exists yet: the task solver, habits, and advisor are Phase 2 and later."
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
