/** Decorative illustration for Northeside (aria-hidden; the surrounding text carries meaning). */
/** Decorative scatter of small bars around the hero, echoing a stadium scoreboard. */
export function HeroScatter() {
  const bars = [
    [8, 22, 6, 30, 0], [12, 70, 4, 18, 1], [86, 16, 5, 24, 0], [91, 60, 4, 34, 1], [80, 82, 6, 16, 0],
    [18, 88, 3, 14, 1], [5, 50, 3, 12, 0], [95, 30, 3, 14, 0], [70, 12, 4, 10, 1], [28, 10, 3, 12, 0],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block">
      {bars.map(([x, y, w, h, accent], i) => (
        <span
          key={i}
          className="absolute animate-rise rounded-[2px]"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: w,
            height: h,
            background: accent ? "var(--color-accent)" : "var(--color-line-strong)",
            animationDelay: `${200 + i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}
