import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

const PHASES = [
  { name: "Phase 0 — Foundation", status: "done" as const, detail: "Schema, RLS, dispatcher stub, brand system, house style." },
  { name: "Phase 1 — Grid, read-only", status: "next" as const, detail: "buildGrid, week view rendering hard placements." },
  { name: "Phase 2 — Task solver", status: "later" as const, detail: "Least-slack-time solver, movement penalty, freeze window." },
  { name: "Phase 3 — Habits", status: "later" as const, detail: "Second-pass placement, spacing constraints." },
  { name: "Phase 4 — Meeting offers", status: "later" as const, detail: "Displacement cost, tentative holds, expiry cron." },
  { name: "Phase 4.5 — Reminders core", status: "later" as const, detail: "Urgency, receptivity, attention budget." },
  { name: "Phase 5 — Future windows", status: "later" as const, detail: "Projected load, window scoring, defended holds." },
  { name: "Phase 6 — Advisor and reconciliation", status: "later" as const, detail: "Signal queries, daily brief, calibration." },
  { name: "Phase 7 — Google Calendar import", status: "later" as const, detail: "Read-only pull, deduplicated on external_id." },
];

const STATUS_LABEL: Record<
  (typeof PHASES)[number]["status"],
  { label: string; tone: "success" | "info" | "neutral" }
> = {
  done: { label: "Done", tone: "success" },
  next: { label: "Next", tone: "info" },
  later: { label: "Not started", tone: "neutral" },
};

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Calendula is under construction"
        lead="This is Phase 0: schema, row-level security, the solver dispatch stub, and the brand and house style system. No scheduling logic exists yet — the week view, task solver, and advisor are all Phase 1 and later."
      />

      <Panel>
        <h2 className="text-base font-semibold mb-4">Build phases</h2>
        <ul className="flex flex-col gap-3">
          {PHASES.map((phase) => (
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
    </>
  );
}
