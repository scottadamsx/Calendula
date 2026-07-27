/**
 * The mark: a radial disc of ray florets (spec §14.2).
 * Twelve outer petals (one per month, the calendae link made structural),
 * twelve inner florets offset 15°, a Disc-coloured centre with six Ember
 * pollen dots. Generated from the construction rule rather than hand-traced,
 * so the 15° offset and petal count stay provably correct.
 */

const OUTER_COUNT = 12;
const INNER_COUNT = 12;
const DOT_COUNT = 6;
const CENTER = 50;

function polarPoints(count: number, offsetDeg: number) {
  return Array.from({ length: count }, (_, i) => i * (360 / count) + offsetDeg);
}

interface CalendulaMarkProps {
  size?: number;
  /** Drop the inner floret ring at favicon scale (spec §14.2 minimum-size rule). */
  dense?: boolean;
  className?: string;
}

export function CalendulaMark({ size = 40, dense = true, className }: CalendulaMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Calendula"
      className={className}
    >
      {polarPoints(OUTER_COUNT, 0).map((angle) => (
        <ellipse
          key={`outer-${angle}`}
          cx={CENTER}
          cy={CENTER - 26}
          rx={7}
          ry={17}
          fill="var(--color-brand-600)"
          transform={`rotate(${angle} ${CENTER} ${CENTER})`}
        />
      ))}

      {dense &&
        polarPoints(INNER_COUNT, 15).map((angle) => (
          <ellipse
            key={`inner-${angle}`}
            cx={CENTER}
            cy={CENTER - 17}
            rx={4.5}
            ry={11}
            fill="var(--color-accent-reminder)"
            transform={`rotate(${angle} ${CENTER} ${CENTER})`}
          />
        ))}

      <circle cx={CENTER} cy={CENTER} r={13} fill="var(--color-ink)" />

      {polarPoints(DOT_COUNT, 0).map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const r = 7;
        return (
          <circle
            key={`dot-${angle}`}
            cx={CENTER + r * Math.sin(rad)}
            cy={CENTER - r * Math.cos(rad)}
            r={1.6}
            fill="var(--color-danger)"
          />
        );
      })}
    </svg>
  );
}
