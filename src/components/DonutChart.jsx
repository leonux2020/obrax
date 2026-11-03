/**
 * OLED donut chart in plain SVG (no chart library): a ring split in solid segments, a completely hollow centre (nothing is painted there:
 * the black of the screen shows through) and whatever the caller puts in `children` centred over the hole.
 *
 * `segments`: [{ key, pct (0-100), color }]. Every segment is a circle stroked with a dash of `pct` over a path length of 100, so the maths
 * stay exact at any size. A hairline gap separates them when there are several. With no segment a faint track ring is drawn instead.
 */
const R = 42; // radius of the ring's centre line (viewBox 100)
const STROKE = 10;
const GAP = 0.8; // hairline between segments, in % of the ring

export default function DonutChart({ segments = [], size = 224, label = '', testId = 'donut', children = null }) {
  const live = segments.filter((s) => s.pct > 0);
  let from = 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size, maxWidth: '100%' }} data-testid={testId}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={label} focusable="false" className="block -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} data-testid={`${testId}-track`} />
        {live.map((s) => {
          const gap = live.length > 1 ? GAP : 0;
          const len = Math.max(0.2, s.pct - gap);
          const el = (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              pathLength="100"
              strokeDasharray={`${len} ${100 - len}`}
              strokeDashoffset={-from}
              data-testid={`${testId}-seg-${s.key}`}
              data-pct={s.pct.toFixed(1)}
            />
          );
          from += s.pct;
          return el;
        })}
      </svg>
      {/* the hole: transparent, only the text of the main metric sits in it */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ padding: '17%' }}>
        <div className="min-w-0 max-w-full text-center">{children}</div>
      </div>
    </div>
  );
}
