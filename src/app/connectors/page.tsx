import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConnectSupabasePanel } from "@/components/connectors/ConnectSupabasePanel";

export default function ConnectorsPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Integrations"
        lead="External systems Calendula reads from or writes to. Calendar write-back is explicitly out of scope (D14) — Google Calendar is read-only import, and it lands in Phase 7."
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink">Supabase</h3>
              <Badge tone={supabaseConfigured ? "success" : "neutral"}>
                {supabaseConfigured ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <p className="text-xs text-ink-soft max-w-[48ch]">
              Postgres, auth, and row-level security — the truth layer every solver reads through
              the grid.
            </p>
          </div>
          <ConnectSupabasePanel configured={supabaseConfigured} />
        </Panel>

        <Panel className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink">Google Calendar</h3>
              <Badge tone={googleConfigured ? "success" : "neutral"}>
                {googleConfigured ? "Credentials set" : "Not connected"}
              </Badge>
            </div>
            <p className="text-xs text-ink-soft max-w-[48ch]">
              Read-only pull into fixed_blocks, deduplicated on external_id (spec §5.4, §13).
              Never writes back to Google. The reconciliation engine (import, update, and
              delete-when-removed-upstream logic) is built and unit-tested — see{" "}
              <code className="font-data">googleCalendarSync.ts</code>.
            </p>
            <p className="text-xs text-ink-faint mt-1">
              {googleConfigured
                ? "Credentials are set, but the OAuth authorization flow and Calendar API fetch itself aren't wired up yet — untested integration code isn't worth shipping. That's the remaining piece."
                : "Blocked on a Google Cloud OAuth app (Client ID + Secret) — something only you can create in the Google Cloud Console, the same kind of external account setup as an ANTHROPIC_API_KEY. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to connect."}
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled>
            Connect
          </Button>
        </Panel>
      </div>
    </>
  );
}
