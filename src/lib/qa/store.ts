import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only QA tracker: has a build phase actually been clicked through and
 * confirmed by a human, or just built and automated-tested? File-based on
 * purpose — this has to work with zero Supabase project configured (Phase
 * 0/1's own constraint), and it's process tooling, not product data, so it
 * doesn't belong in the domain schema (spec §5). Persists fine for local
 * dev; note if this ever needs to survive a serverless/Vercel deploy, the
 * filesystem won't do it there and this should move to a real table.
 */

const FILE_PATH = path.join(process.cwd(), "qa-status.json");

export interface QaBug {
  id: string;
  text: string;
  reportedAt: string;
  resolvedAt: string | null;
}

export interface QaPhaseState {
  verified: boolean;
  verifiedAt: string | null;
  bugs: QaBug[];
}

export type QaStatus = Record<string, QaPhaseState>;

export async function readQaStatus(): Promise<QaStatus> {
  try {
    const raw = await readFile(FILE_PATH, "utf-8");
    return JSON.parse(raw) as QaStatus;
  } catch {
    return {};
  }
}

export async function writeQaStatus(status: QaStatus): Promise<void> {
  await writeFile(FILE_PATH, `${JSON.stringify(status, null, 2)}\n`, "utf-8");
}

export function emptyPhaseState(): QaPhaseState {
  return { verified: false, verifiedAt: null, bugs: [] };
}
