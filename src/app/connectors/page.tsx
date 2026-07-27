import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function Connector({
  name,
  description,
  status,
  disabledReason,
}: {
  name: string;
  description: string;
  status: "connected" | "not_connected" | "not_available";
  disabledReason?: string;
}) {
  const badge =
    status === "connected"
      ? { tone: "success" as const, label: "Connected" }
      : status === "not_connected"
        ? { tone: "neutral" as const, label: "Not connected" }
        : { tone: "neutral" as const, label: "Not yet available" };

  return (
    <Panel className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-ink">{name}</h3>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="text-xs text-ink-soft max-w-[48ch]">{description}</p>
        {disabledReason && <p className="text-xs text-ink-faint mt-1">{disabledReason}</p>}
      </div>
      <Button
        variant={status === "connected" ? "quiet" : "secondary"}
        size="sm"
        disabled={status === "not_available"}
      >
        {status === "connected" ? "Disconnect" : "Connect"}
      </Button>
    </Panel>
  );
}

export default function ConnectorsPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Integrations"
        lead="External systems Calendula reads from or writes to. Calendar write-back is explicitly out of scope (D14) — Google Calendar is read-only import, and it lands in Phase 7."
      />

      <div className="flex flex-col gap-4">
        <Connector
          name="Supabase"
          description="Postgres, auth, and row-level security — the truth layer every solver reads through the grid."
          status={supabaseConfigured ? "connected" : "not_connected"}
          disabledReason={
            supabaseConfigured
              ? undefined
              : "No project configured. Set NEXT_PUBLIC_SUPABASE_URL and the anon key to connect (see Settings)."
          }
        />
        <Connector
          name="Google Calendar"
          description="Read-only pull into fixed_blocks, deduplicated on external_id (spec §5.4, §13). Never writes back to Google."
          status="not_available"
          disabledReason="Ships in Phase 7. Requires Google OAuth verification, begun during Phase 2 (spec §4)."
        />
      </div>
    </>
  );
}
