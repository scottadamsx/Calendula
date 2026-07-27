import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="The engine, not just the UI"
        lead="Calendula schedules a whole life — work, relationships, habits, and multi-day plans defended months out. This page explains the machine underneath. The full specification lives in calendula-v3-documentation.md at the repo root."
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="text-base font-semibold mb-2">The design thesis</h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            <strong className="text-ink">The schedulers are deterministic. The LLM lives only at
            the edges.</strong> Turning messy text into structured records, and turning solver
            output into plain English, are LLM jobs. Deciding where a task actually goes on the
            calendar is an algorithm — never a model. That keeps placement debuggable,
            reproducible, and cheap to re-run.
          </p>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-3">The flow</h2>
          <ol className="flex flex-col gap-3 text-sm text-ink-soft">
            <li>
              <strong className="text-ink">1. Ingestion (LLM).</strong> Natural language becomes
              structured rows — tasks, fixed blocks, reminders, people.
            </li>
            <li>
              <strong className="text-ink">2. Truth layer.</strong> Postgres tables, every one
              scoped by <code className="font-data">user_id</code> and protected by row-level
              security.
            </li>
            <li>
              <strong className="text-ink">3. Grid engine.</strong> The single source every solver
              reads: a time-sliced availability grid built from one occupancy table,{" "}
              <code className="font-data">placements</code>.
            </li>
            <li>
              <strong className="text-ink">4. Four parallel schedulers.</strong> The task solver
              places work by least slack time. The window planner defends future multi-day plans
              against projected — not current — load. The offer engine finds meeting slots and
              knows their true displacement cost. The reminder engine spends a fixed daily
              attention budget instead of notifying unconditionally.
            </li>
            <li>
              <strong className="text-ink">5. Advisor (LLM).</strong> Reads the deterministic
              output and writes the English. It proposes; it never writes to the schedule
              directly.
            </li>
            <li>
              <strong className="text-ink">6. Reconciliation.</strong> A sixty-second evening
              check-in compares planned to actual time and recalibrates estimates per category —
              the layer most planners skip, and the reason they rot.
            </li>
          </ol>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-3">Two scarce resources, one grid</h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            The task solver optimises <em>time</em> — 15-minute blocks, ordered by least slack.
            The reminder engine optimises <em>attention</em> — interruptions, ordered by urgency
            times receptivity. Both read the same grid, so a fully-scheduled calendar can still
            answer &ldquo;can you meet Thursday?&rdquo; honestly, because every block knows
            whether it&rsquo;s hard, soft, or tentative.
          </p>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-2">What makes it different</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink-soft list-disc list-inside">
            <li>Tracks relationship cadence and proposes specific times when the gap opens.</li>
            <li>Defends a future weekend by projecting what will become busy, not what&rsquo;s
              currently blank.</li>
            <li>Tells you the honest cost of saying yes instead of just reporting a free slot.</li>
            <li>Batches reminders at natural boundaries so seven notifications cost three
              interruptions.</li>
            <li>Notices a reminder you keep deferring and offers to turn it into real scheduled
              time.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
