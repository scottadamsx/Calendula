/**
 * Pure reconciliation for spec §16 Phase 7 — "read-only pull into
 * fixed_blocks, deduplicated on external_id." The two acceptance criteria
 * ("re-import is idempotent," "events deleted upstream are removed
 * locally") are both properties of this diffing algorithm, not of the
 * Google API call that supplies its input — so this is fully buildable and
 * testable without live OAuth credentials. See CLAUDE.md for why the OAuth
 * token exchange itself isn't built.
 */

export interface GoogleEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
}

export interface ExistingImportedBlock {
  id: string;
  externalId: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
}

export interface SyncPlan {
  toInsert: GoogleEvent[];
  toUpdate: { blockId: string; event: GoogleEvent }[];
  toDelete: { blockId: string; externalId: string }[];
}

function eventChanged(existing: ExistingImportedBlock, event: GoogleEvent): boolean {
  return (
    existing.title !== event.title ||
    existing.starts_at.getTime() !== event.start.getTime() ||
    existing.ends_at.getTime() !== event.end.getTime() ||
    existing.location !== event.location
  );
}

/**
 * `currentEvents` is the *complete* result of the latest pull from Google
 * for the synced window — anything previously imported (by `external_id`)
 * that's absent from this set is treated as deleted upstream, per the
 * spec's own acceptance criterion. Re-running with the exact same
 * `currentEvents` against its own prior output produces an empty plan —
 * that's what "re-import is idempotent" means operationally.
 */
export function planGoogleCalendarSync(currentEvents: GoogleEvent[], existingBlocks: ExistingImportedBlock[]): SyncPlan {
  const existingByExternalId = new Map(existingBlocks.map((b) => [b.externalId, b]));
  const currentIds = new Set(currentEvents.map((e) => e.id));

  const toInsert: GoogleEvent[] = [];
  const toUpdate: SyncPlan["toUpdate"] = [];
  for (const event of currentEvents) {
    const existing = existingByExternalId.get(event.id);
    if (!existing) {
      toInsert.push(event);
    } else if (eventChanged(existing, event)) {
      toUpdate.push({ blockId: existing.id, event });
    }
  }

  const toDelete: SyncPlan["toDelete"] = existingBlocks
    .filter((b) => !currentIds.has(b.externalId))
    .map((b) => ({ blockId: b.id, externalId: b.externalId }));

  return { toInsert, toUpdate, toDelete };
}
