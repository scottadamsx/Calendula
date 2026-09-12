import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ChatInterface, type StoredMessage } from "@/components/chat/ChatInterface";

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Chat" title="Talk to your calendar" lead="Tell it what's going on — it reads and updates the real schedule." />
      <Panel>
        <p className="text-sm text-ink-soft">{children}</p>
      </Panel>
    </>
  );
}

export default async function ChatPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <NotConnected>
        No Supabase project configured yet — see{" "}
        <Link href="/connectors" className="text-brand-600 hover:text-brand-700 underline">
          Connectors
        </Link>
        .
      </NotConnected>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <NotConnected>
        No signed-in session.{" "}
        <Link href="/login" className="text-brand-600 hover:text-brand-700 underline">
          Sign in
        </Link>{" "}
        first.
      </NotConnected>
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return (
      <NotConnected>
        This needs an <code className="font-data">ANTHROPIC_API_KEY</code>, which isn&rsquo;t set yet. Add it to{" "}
        <code className="font-data">.env.local</code>, then come back — see{" "}
        <Link href="/settings" className="text-brand-600 hover:text-brand-700 underline">
          Settings
        </Link>{" "}
        for credential status. Everything else in Calendula (Week, Meetings, Reminders, Planning, Check-in, Advisor)
        works without it.
      </NotConnected>
    );
  }

  const { data: rows } = await supabase
    .from("calendula_chat_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("seq", { ascending: true });

  const initialMessages: StoredMessage[] = (rows ?? []).map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Chat"
        title="Talk to your calendar"
        lead="Add tasks, block off recurring commitments, set reminders, or ask what your week looks like — in plain English. It'll ask a quick multiple-choice question if it genuinely needs to know more."
      />
      <ChatInterface initialMessages={initialMessages} />
    </>
  );
}
