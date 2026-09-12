import Link from "next/link";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

type Block = { type: string; [key: string]: unknown };
type Row = { role: "user" | "assistant"; content: Block[]; created_at: string };

const ACTION_LABELS: Record<string, string> = {
  create_task: "Task",
  create_habit: "Habit",
  create_fixed_block: "Fixed commitment",
  create_reminder: "Reminder",
  get_week_overview: "Looked at the week",
  list_calendar_items: "Listed the calendar",
  delete_calendar_item: "Deleted",
};

const READ_ONLY = new Set(["get_week_overview", "list_calendar_items"]);

interface Action {
  name: string;
  title: string;
  ok: boolean | null;
  detail: string | null;
}

interface Question {
  question: string;
  answer: string | null;
}

interface Turn {
  at: DateTime;
  prompt: string;
  actions: Action[];
  questions: Question[];
  reply: string | null;
}

/**
 * Derived entirely from the persisted chat transcript — every tool call the
 * agent made and what it reported back — so there's no second write path to
 * drift out of sync with the conversation itself.
 */
function buildTurns(rows: Row[], zone: string): Turn[] {
  const turns: Turn[] = [];
  const pending = new Map<string, Action | Question>();
  let current: Turn | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      const text = row.content
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("\n")
        .trim();
      if (text) {
        current = { at: DateTime.fromISO(row.created_at, { zone }), prompt: text, actions: [], questions: [], reply: null };
        turns.push(current);
      }
      for (const b of row.content) {
        if (b.type !== "tool_result") continue;
        const target = pending.get(String(b.tool_use_id));
        if (!target) continue;
        const raw = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        if ("question" in target) {
          target.answer = raw;
        } else {
          try {
            const parsed = JSON.parse(raw) as { ok?: boolean; message?: string; weekOf?: string; items?: unknown[] };
            if (typeof parsed.ok === "boolean") {
              target.ok = parsed.ok;
              target.detail = parsed.message ?? null;
            } else if (parsed.weekOf) {
              target.ok = true;
              target.detail = `Week of ${parsed.weekOf} — ${parsed.items?.length ?? 0} things on it`;
            } else {
              target.ok = true;
            }
          } catch {
            target.detail = raw;
          }
        }
        pending.delete(String(b.tool_use_id));
      }
      continue;
    }

    if (!current) continue;
    for (const b of row.content) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        current.reply = b.text.replace(/\*\*/g, "").replace(/^\s*[-*•]\s+/gm, "").trim();
      }
      if (b.type !== "tool_use") continue;
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (b.name === "ask_multiple_choice") {
        const q: Question = { question: String(input.question ?? ""), answer: null };
        current.questions.push(q);
        pending.set(String(b.id), q);
      } else {
        const name = String(b.name);
        const a: Action = {
          name,
          title: typeof input.title === "string" ? input.title : ACTION_LABELS[name] ?? name,
          ok: null,
          detail: null,
        };
        current.actions.push(a);
        pending.set(String(b.id), a);
      }
    }
  }
  return turns;
}

export default async function HistoryPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <>
        <PageHeader eyebrow="History" title="What the chat has done" lead="Every conversation and every change it made, newest first." />
        <Panel>
          <p className="text-sm text-ink-soft">
            No Supabase project configured yet — see{" "}
            <Link href="/connectors" className="text-brand-600 hover:text-brand-700 underline">
              Connectors
            </Link>
            .
          </p>
        </Panel>
      </>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <>
        <PageHeader eyebrow="History" title="What the chat has done" lead="Every conversation and every change it made, newest first." />
        <Panel>
          <p className="text-sm text-ink-soft">
            No signed-in session.{" "}
            <Link href="/login" className="text-brand-600 hover:text-brand-700 underline">
              Sign in
            </Link>{" "}
            first.
          </p>
        </Panel>
      </>
    );
  }

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from("calendula_scheduling_profile").select("timezone").eq("user_id", user.id).single(),
    supabase
      .from("calendula_chat_messages")
      .select("role, content, created_at")
      .eq("user_id", user.id)
      .order("seq", { ascending: true }),
  ]);
  const zone = profile?.timezone ?? "UTC";
  const turns = buildTurns((rows ?? []) as Row[], zone).reverse();

  const added = turns.flatMap((t) => t.actions).filter((a) => a.ok === true && !READ_ONLY.has(a.name) && a.name !== "delete_calendar_item").length;
  const refused = turns.flatMap((t) => t.actions).filter((a) => a.ok === false).length;

  const byDay = new Map<string, Turn[]>();
  for (const t of turns) {
    const key = t.at.toFormat("cccc, LLLL d");
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="What the chat has done"
        lead={`${turns.length} message${turns.length === 1 ? "" : "s"} · ${added} added to the calendar · ${refused} refused (conflicts or bad input). Every change the agent made, with what it reported back — newest first.`}
      />

      {turns.length === 0 && (
        <Panel>
          <p className="text-sm text-ink-soft">
            Nothing yet. Go to{" "}
            <Link href="/" className="text-brand-600 hover:text-brand-700 underline">
              Chat
            </Link>{" "}
            and tell it something.
          </p>
        </Panel>
      )}

      <div className="flex flex-col gap-4">
        {[...byDay.entries()].map(([day, dayTurns]) => (
          <Panel key={day}>
            <h2 className="text-base font-semibold mb-3">{day}</h2>
            <ol className="flex flex-col divide-y divide-line">
              {dayTurns.map((t, i) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="font-data text-xs text-ink-faint shrink-0 w-[7ch]">{t.at.toFormat("h:mm a")}</span>
                    <p className="text-sm text-ink">{t.prompt}</p>
                  </div>
                  {(t.actions.length > 0 || t.questions.length > 0) && (
                    <ul className="ml-[calc(7ch+0.75rem)] flex flex-col gap-1.5">
                      {t.questions.map((q, j) => (
                        <li key={`q${j}`} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone="info">Asked</Badge>
                          <span className="text-ink-soft">{q.question}</span>
                          {q.answer && <span className="text-brand-700 font-medium">→ {q.answer}</span>}
                        </li>
                      ))}
                      {t.actions.map((a, j) => (
                        <li key={`a${j}`} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={a.ok === false ? "danger" : READ_ONLY.has(a.name) ? "neutral" : a.name === "delete_calendar_item" ? "warn" : a.ok === true ? "success" : "neutral"}>
                            {a.ok === false ? "Refused" : READ_ONLY.has(a.name) ? "Looked" : a.name === "delete_calendar_item" ? "Deleted" : a.ok === true ? "Added" : "Pending"}
                          </Badge>
                          <span className="text-ink font-medium">
                            {READ_ONLY.has(a.name) || a.name === "delete_calendar_item" ? ACTION_LABELS[a.name] : `${ACTION_LABELS[a.name] ?? a.name}: ${a.title}`}
                          </span>
                          {a.detail && <span className="text-ink-soft">— {a.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.reply && (
                    <p className="ml-[calc(7ch+0.75rem)] text-xs text-ink-soft max-w-[80ch]">{t.reply}</p>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
    </>
  );
}
