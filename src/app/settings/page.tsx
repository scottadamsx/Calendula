import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

function EnvStatus({ name }: { name: string }) {
  const present = Boolean(process.env[name]);
  return (
    <li className="flex items-center justify-between h-10 px-1">
      <span className="font-data text-xs text-ink-soft">{name}</span>
      <Badge tone={present ? "success" : "neutral"}>{present ? "Set" : "Not set"}</Badge>
    </li>
  );
}

const MODEL_ROUTING = [
  { layer: "Ingestion", model: "Haiku / Sonnet", note: "Natural language → structured records" },
  { layer: "Digest rendering", model: "Haiku", note: "Batched reminder digests" },
  { layer: "Daily brief", model: "Sonnet", note: "Advisor's morning summary" },
  { layer: "Overload triage", model: "Opus", note: "Non-trivial displacement tradeoffs" },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Configuration"
        lead="Credential status, scheduling defaults, and where Calendula's data lives. Nothing here is wired to a live database yet — Phase 0 ships the schema and RLS, not the app that reads it."
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="text-base font-semibold mb-1">Credentials</h2>
          <p className="text-xs text-ink-soft mb-4">
            Read from the server environment at request time. Values are never displayed, only
            presence.
          </p>
          <ul className="flex flex-col divide-y divide-line">
            <EnvStatus name="NEXT_PUBLIC_SUPABASE_URL" />
            <EnvStatus name="NEXT_PUBLIC_SUPABASE_ANON_KEY" />
            <EnvStatus name="SUPABASE_SERVICE_ROLE_KEY" />
            <EnvStatus name="SUPABASE_DB_URL" />
            <EnvStatus name="ANTHROPIC_API_KEY" />
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-1">Scheduling defaults</h2>
          <p className="text-xs text-ink-soft mb-4">
            The <code className="font-data">scheduling_profile</code> and{" "}
            <code className="font-data">attention_profile</code> row seeded for one user (spec
            §5.1, §19). Editable once the profile UI ships in a later phase — shown here as the
            defaults a fresh database seeds with, not a live value.
          </p>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-soft">Timezone</dt>
            <dd className="font-data text-right">America/St_Johns</dd>
            <dt className="text-ink-soft">Sleep window</dt>
            <dd className="font-data text-right">23:30–07:30</dd>
            <dt className="text-ink-soft">Horizon / far horizon</dt>
            <dd className="font-data text-right">14d / 180d</dd>
            <dt className="text-ink-soft">Max task minutes / day</dt>
            <dd className="font-data text-right">300</dd>
            <dt className="text-ink-soft">Attention budget / day</dt>
            <dd className="font-data text-right">5</dd>
          </dl>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-1">Model routing</h2>
          <p className="text-xs text-ink-soft mb-4">
            Fixed per architectural decision D1 — the LLM lives only at the edges (spec §11).
            Not user-configurable; shown for transparency.
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {MODEL_ROUTING.map((row) => (
              <li key={row.layer} className="flex items-center justify-between h-10">
                <div>
                  <div className="text-sm text-ink">{row.layer}</div>
                  <div className="text-xs text-ink-soft">{row.note}</div>
                </div>
                <span className="font-data text-xs text-brand-700">{row.model}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold mb-1">Data location</h2>
          <p className="text-sm text-ink-soft">
            Supabase Postgres with row-level security on every table (spec §4, §5). No project is
            provisioned yet — see{" "}
            <a href="/connectors" className="text-brand-600 hover:text-brand-700 underline">
              Connectors
            </a>{" "}
            to check connection status.
          </p>
        </Panel>
      </div>
    </>
  );
}
