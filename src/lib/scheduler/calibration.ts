/** Pure pieces of reconciliation and calibration (spec §12). */

export interface CompletionSample {
  actualMinutes: number;
  plannedMinutes: number;
}

/**
 * spec §12: `multiplier = median(actual_minutes / planned_minutes)`,
 * required `sample_size >= 5`, clamped to [0.5, 3.0]. Median rather than
 * mean is deliberate — "one eight-hour debugging session must not
 * permanently inflate every future estimate" (D12). Returns null when
 * there aren't enough samples yet, distinct from 1.0 (no drift) — the
 * caller must not write a multiplier that hasn't earned its sample size.
 */
export function computeMultiplier(samples: CompletionSample[]): number | null {
  if (samples.length < 5) return null;

  const ratios = samples
    .filter((s) => s.plannedMinutes > 0)
    .map((s) => s.actualMinutes / s.plannedMinutes)
    .sort((a, b) => a - b);
  if (ratios.length < 5) return null;

  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];

  return Math.max(0.5, Math.min(3.0, median));
}
