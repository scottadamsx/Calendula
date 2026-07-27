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
  /** Petals unfurl on load, centre-out (spec §14.6). Off by default — this
   * is a one-time "celebration beat" for a hero placement, not persistent
   * chrome like the sidebar mark, which should stay still. */
  animated?: boolean;
}

export function CalendulaMark({
  size = 40,
  dense = true,
  className,
  animated = false,
}: CalendulaMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Calendula"
      className={className}
    >
      {polarPoints(OUTER_COUNT, 0).map((angle, i) => (
        <g key={`outer-${angle}`} transform={`rotate(${angle} ${CENTER} ${CENTER})`}>
          <ellipse
            cx={CENTER}
            cy={CENTER - 26}
            rx={7}
            ry={17}
            fill="var(--color-brand-600)"
            className={animated ? "calendula-bloom-outer" : undefined}
            style={animated ? { transformOrigin: `${CENTER}px ${CENTER}px`, animationDelay: `${80 + i * 35}ms` } : undefined}
          />
        </g>
      ))}

      {dense &&
        polarPoints(INNER_COUNT, 15).map((angle, i) => (
          <g key={`inner-${angle}`} transform={`rotate(${angle} ${CENTER} ${CENTER})`}>
            <ellipse
              cx={CENTER}
              cy={CENTER - 17}
              rx={4.5}
              ry={11}
              fill="var(--color-accent-reminder)"
              className={animated ? "calendula-bloom-inner" : undefined}
              style={
                animated
                  ? { transformOrigin: `${CENTER}px ${CENTER}px`, animationDelay: `${300 + i * 30}ms` }
                  : undefined
              }
            />
          </g>
        ))}

      <circle
        cx={CENTER}
        cy={CENTER}
        r={13}
        fill="var(--color-ink)"
        className={animated ? "calendula-bloom-center" : undefined}
        style={animated ? { transformOrigin: `${CENTER}px ${CENTER}px` } : undefined}
      />

      {polarPoints(DOT_COUNT, 0).map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const r = 7;
        return (
          <circle
            key={`dot-${angle}`}
            cx={CENTER + r * Math.sin(rad)}
            cy={CENTER - r * Math.cos(rad)}
            r={1.6}
            fill="var(--color-danger)"
            className={animated ? "calendula-bloom-dot" : undefined}
            style={
              animated
                ? {
                    transformOrigin: `${CENTER + r * Math.sin(rad)}px ${CENTER - r * Math.cos(rad)}px`,
                    animationDelay: `${560 + i * 25}ms`,
                  }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}
