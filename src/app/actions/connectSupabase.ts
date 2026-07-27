"use server";

import { createClient } from "@supabase/supabase-js";
import { upsertEnvLocal } from "@/lib/config/envLocal";
import { runMigrations } from "@/lib/db/runMigrations";

export interface ConnectStep {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ConnectResult {
  steps: ConnectStep[];
  ok: boolean;
}

/**
 * The whole "no terminal" Connect flow in one action: save the pasted
 * credentials, confirm they actually reach a live project, apply the schema
 * if it isn't there yet, confirm it landed. Each stage is a step the UI can
 * render as it completes — if one fails, later steps are skipped rather
 * than attempted against a known-bad state.
 *
 * Deliberately does NOT run supabase/seed.sql — that inserts a demo login
 * with a hardcoded password directly into auth.users, which is fine for a
 * disposable local database but not something to run automatically against
 * a real project a person pasted in.
 */
export async function connectSupabase(
  _prev: ConnectResult | null,
  formData: FormData,
): Promise<ConnectResult> {
  const url = String(formData.get("url") ?? "").trim();
  const anonKey = String(formData.get("anonKey") ?? "").trim();
  const serviceRoleKey = String(formData.get("serviceRoleKey") ?? "").trim();
  const dbUrl = String(formData.get("dbUrl") ?? "").trim();

  const steps: ConnectStep[] = [];

  if (!url || !anonKey || !serviceRoleKey || !dbUrl) {
    return {
      ok: false,
      steps: [{ label: "Check the form", ok: false, detail: "All four fields are required." }],
    };
  }

  // Step 1 — can we actually reach the project with these keys?
  try {
    const supabase = createClient(url, anonKey);
    const { error } = await supabase
      .from("scheduling_profile")
      .select("user_id")
      .limit(1);
    // A missing-table error here is expected pre-migration and still proves
    // the project itself is reachable — only a connection/auth failure is
    // a real problem at this step.
    if (error && !isMissingTableError(error.message)) {
      steps.push({ label: "Reach the project", ok: false, detail: error.message });
      return { ok: false, steps };
    }
    steps.push({ label: "Reach the project", ok: true, detail: "Project responded." });
  } catch (err) {
    steps.push({
      label: "Reach the project",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown connection error.",
    });
    return { ok: false, steps };
  }

  // Step 2 — apply the schema.
  try {
    const results = await runMigrations(dbUrl);
    const appliedCount = results.filter((r) => r.action === "applied").length;
    const skippedCount = results.length - appliedCount;
    steps.push({
      label: "Apply the schema",
      ok: true,
      detail:
        appliedCount > 0
          ? `Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"}${skippedCount ? `, ${skippedCount} already in place` : ""}.`
          : "Schema was already up to date.",
    });
  } catch (err) {
    steps.push({
      label: "Apply the schema",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown migration error.",
    });
    return { ok: false, steps };
  }

  // Step 3 — re-verify against the now-migrated schema.
  try {
    const supabase = createClient(url, anonKey);
    const { error } = await supabase.from("scheduling_profile").select("user_id").limit(1);
    if (error) {
      steps.push({ label: "Verify the schema", ok: false, detail: error.message });
      return { ok: false, steps };
    }
    steps.push({ label: "Verify the schema", ok: true, detail: "scheduling_profile is queryable." });
  } catch (err) {
    steps.push({
      label: "Verify the schema",
      ok: false,
      detail: err instanceof Error ? err.message : "Unknown error.",
    });
    return { ok: false, steps };
  }

  // Step 4 — persist, now that everything above is confirmed working.
  await upsertEnvLocal({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_DB_URL: dbUrl,
  });
  steps.push({ label: "Save configuration", ok: true, detail: "Written to .env.local." });

  return { ok: true, steps };
}

function isMissingTableError(message: string): boolean {
  // Two different wordings for the same thing: raw Postgres (via a direct pg
  // connection) says "relation ... does not exist"; Supabase's PostgREST
  // layer (via supabase-js) says "Could not find the table '...' in the
  // schema cache" instead. Both mean "reachable, just not migrated yet."
  return (
    /relation .* does not exist/i.test(message) ||
    /could not find the table .* in the schema cache/i.test(message)
  );
}
