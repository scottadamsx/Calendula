"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { readQaStatus, writeQaStatus, emptyPhaseState } from "@/lib/qa/store";

export async function markPhaseVerified(phaseId: string): Promise<void> {
  const status = await readQaStatus();
  const phase = status[phaseId] ?? emptyPhaseState();
  status[phaseId] = { ...phase, verified: true, verifiedAt: new Date().toISOString() };
  await writeQaStatus(status);
  revalidatePath("/");
}

export async function reportPhaseBug(phaseId: string, formData: FormData): Promise<void> {
  const text = String(formData.get("bug") ?? "").trim();
  if (!text) return;

  const status = await readQaStatus();
  const phase = status[phaseId] ?? emptyPhaseState();
  phase.bugs.push({
    id: randomUUID(),
    text,
    reportedAt: new Date().toISOString(),
    resolvedAt: null,
  });
  // A new bug reopens the phase — it can't be "verified" with an open bug.
  phase.verified = false;
  status[phaseId] = phase;
  await writeQaStatus(status);
  revalidatePath("/");
}

export async function resolvePhaseBug(phaseId: string, bugId: string): Promise<void> {
  const status = await readQaStatus();
  const phase = status[phaseId];
  if (!phase) return;

  phase.bugs = phase.bugs.map((bug) =>
    bug.id === bugId ? { ...bug, resolvedAt: new Date().toISOString() } : bug,
  );
  status[phaseId] = phase;
  await writeQaStatus(status);
  revalidatePath("/");
}
