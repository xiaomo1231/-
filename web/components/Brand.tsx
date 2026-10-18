/** The mark (a brass seal with 谱) and the six strings drawn across a band. */

export function Seal({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg bg-primary font-display font-black text-primary-foreground shadow-[var(--shadow-soft)]"
      style={{ width: size, height: size, fontSize: size * 0.56, lineHeight: 1 }}
    >
      谱
    </span>
  )
}

/**
 * Six strings, low E thickest at the bottom, with a fret on the left (the nut)
 * and a few frets further up the neck. `pluck` restarts the little vibration.
 */
export function StringsArt({ pluck = 0, className = '' }: { pluck?: number; className?: string }) {
  const ys = [8, 20, 32, 44, 56, 68]
  const widths = [0.8, 1, 1.2, 1.5, 1.9, 2.4]
  return (
    <svg
      aria-hidden
      viewBox="0 0 320 76"
      preserveAspectRatio="none"
      className={className}
      style={{ display: 'block' }}
    >
      <rect x="0" y="2" width="5" height="72" rx="1.5" fill="hsl(var(--inlay) / 0.75)" />
      {[78, 150, 214, 270].map((x) => (
        <rect key={x} x={x} y="2" width="2.5" height="72" rx="1" fill="hsl(var(--fret) / 0.7)" />
      ))}
      <circle cx="182" cy="38" r="4" fill="hsl(var(--inlay) / 0.5)" />
      <circle cx="242" cy="38" r="4" fill="hsl(var(--inlay) / 0.5)" />
      <g key={pluck} className={pluck ? 'vibrate' : undefined}>
        {ys.map((y, i) => (
          <line
            key={y}
            x1="5"
            x2="320"
            y1={y}
            y2={y}
            stroke="hsl(var(--string))"
            strokeOpacity={0.55 + i * 0.07}
            strokeWidth={widths[i]}
          />
        ))}
      </g>
    </svg>
  )
}
