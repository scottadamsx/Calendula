import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ConnectSupabasePanel } from "@/components/connectors/ConnectSupabasePanel";

export default function ConnectorsPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Integrations"
        lead="External systems Calendula reads from or writes to. Calendar write-back is explicitly out of scope (D14), and external calendar import was dropped by choice — the Chat page is how things get in."
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
      </div>
    </>
  );
}
