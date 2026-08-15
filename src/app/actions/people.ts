"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface CreatePersonResult {
  ok: boolean;
  message: string;
}

/** spec §5.3 — "desired_cadence_days is the entire relationship feature. Null means untracked." */
export async function createPerson(_prev: CreatePersonResult | null, formData: FormData): Promise<CreatePersonResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const desiredCadenceDaysRaw = String(formData.get("desiredCadenceDays") ?? "").trim();
  const desiredCadenceDays = desiredCadenceDaysRaw ? Number(desiredCadenceDaysRaw) : null;

  if (!name) return { ok: false, message: "Name is required." };

  const { error } = await supabase.from("calendula_people").insert({
    user_id: user.id,
    name,
    desired_cadence_days: desiredCadenceDays,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/advisor");
  return { ok: true, message: `"${name}" added.` };
}

export interface LogInteractionResult {
  ok: boolean;
  message: string;
}

/** A manual "talked to them today" outside of a confirmed meeting (meetings.ts already updates this on confirm). */
export async function logInteraction(personId: string): Promise<LogInteractionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase
    .from("calendula_people")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", personId)
    .eq("user_id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/advisor");
  return { ok: true, message: "Logged." };
}
