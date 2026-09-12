"use server";

import { revalidatePath } from "next/cache";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { runAgentTurn } from "@/lib/agent/chat";
import { userMessageAnswering } from "@/lib/agent/pendingQuestion";

export interface ChatActionResult {
  ok: boolean;
  message?: string;
  /** Every message persisted this turn, in order — the client appends these directly rather than re-fetching. */
  newMessages?: Anthropic.MessageParam[];
}

async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabase
    .from("calendula_chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("seq", { ascending: true });
  return (data ?? []).map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

async function persistMessages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  messages: Anthropic.MessageParam[],
) {
  if (messages.length === 0) return;
  const { error } = await supabase.from("calendula_chat_messages").insert(
    messages.map((m) => ({ user_id: userId, role: m.role, content: m.content })),
  );
  if (error) throw error;
}

function revalidateAffectedPages() {
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/week");
  revalidatePath("/reminders");
  revalidatePath("/checkin");
}

/** spec §13 named a one-shot `POST /api/ingest`; this is the actual multi-turn conversational version — see src/lib/agent/. */
export async function sendChatMessage(text: string): Promise<ChatActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: "ANTHROPIC_API_KEY isn't set yet — add it in Settings first." };
  }
  if (!text.trim()) return { ok: false, message: "Say something first." };

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  const history = await loadHistory(supabase, user.id);
  const userMessage = userMessageAnswering(history, text);

  const newMessages = await runAgentTurn(user.id, profile.timezone, [...history, userMessage]);
  const toPersist = [userMessage, ...newMessages];
  await persistMessages(supabase, user.id, toPersist);
  revalidateAffectedPages();

  return { ok: true, newMessages: toPersist };
}

/** Continues a paused conversation — the user clicked one of `ask_multiple_choice`'s options. */
export async function answerMultipleChoice(toolUseId: string, answer: string): Promise<ChatActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: "ANTHROPIC_API_KEY isn't set yet — add it in Settings first." };
  }

  const { data: profile } = await supabase
    .from("calendula_scheduling_profile")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  if (!profile) return { ok: false, message: "No scheduling profile — sign in again." };

  const history = await loadHistory(supabase, user.id);
  const toolResultMessage: Anthropic.MessageParam = {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content: answer }],
  };

  const newMessages = await runAgentTurn(user.id, profile.timezone, [...history, toolResultMessage]);
  const toPersist = [toolResultMessage, ...newMessages];
  await persistMessages(supabase, user.id, toPersist);
  revalidateAffectedPages();

  return { ok: true, newMessages: toPersist };
}
