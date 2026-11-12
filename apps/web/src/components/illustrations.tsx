/**
 * Original line illustrations for Northeside. Thin ink strokes, small accent fills, monospace
 * micro-labels, on a dot grid. Decorative: every one is aria-hidden; the card text carries meaning.
 */
const INK = "var(--color-ink)";
const MUTED = "var(--color-line-strong)";
const ACC = "var(--color-accent)";
const SW = 1.4;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 480 260" className="h-auto w-full" aria-hidden fontFamily="var(--font-mono)" fontSize="9">
      {children}
    </svg>
  );
}

function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: string; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill="var(--color-muted)" letterSpacing="0.06em">
      {children}
    </text>
  );
}

/** Picks become a hash before kickoff. */
export function SealArt() {
  const rows = [0, 1, 2, 3, 4];
  return (
    <Frame>
      {rows.map((r) => (
        <g key={r} transform={`translate(40 ${44 + r * 36})`}>
          <rect width="120" height="24" rx="5" fill="white" stroke={INK} strokeWidth={SW} />
          <rect x="8" y="8" width="34" height="8" rx="2" fill={MUTED} />
          <rect x="54" y="6" width="12" height="12" rx="2" fill={r === 1 ? ACC : "white"} stroke={INK} strokeWidth={SW} />
          <rect x="72" y="6" width="12" height="12" rx="2" fill="white" stroke={INK} strokeWidth={SW} />
          <rect x="92" y="8" width="20" height="8" rx="2" fill={MUTED} />
        </g>
      ))}
      <Label x={100} y={30}>YOUR PICKS</Label>
      <path d="M170 128h58" stroke={INK} strokeWidth={SW} strokeDasharray="3 4" />
      <path d="M222 122l8 6-8 6" fill="none" stroke={INK} strokeWidth={SW} />
      <g transform="translate(236 78)">
        <rect width="100" height="100" rx="10" fill={ACC} stroke={INK} strokeWidth={SW} />
        {Array.from({ length: 16 }).map((_, i) => (
          <rect key={i} x={14 + (i % 4) * 19} y={14 + Math.floor(i / 4) * 19} width="13" height="13" rx="2" fill={(i * 7) % 3 === 0 ? INK : "white"} />
        ))}
      </g>
      <Label x={286} y={196}>0x9f2c…e41b</Label>
      <path d="M346 128h44" stroke={INK} strokeWidth={SW} />
      <g transform="translate(390 98)">
        <circle cx="30" cy="30" r="29" fill="white" stroke={INK} strokeWidth={SW} />
        <path d="M30 12v18l12 8" stroke={INK} strokeWidth={SW + 0.4} fill="none" strokeLinecap="round" />
        <circle cx="30" cy="30" r="3" fill={ACC} stroke={INK} strokeWidth="1" />
      </g>
      <Label x={420} y={176}>KICKOFF</Label>
    </Frame>
  );
}

/** Two independent providers must agree. */
export function SourcesArt() {
  return (
    <Frame>
      {[60, 170].map((y, i) => (
        <g key={y} transform={`translate(40 ${y - 30})`}>
          <rect width="130" height="60" rx="8" fill="white" stroke={INK} strokeWidth={SW} />
          <text x="16" y="25" fill={INK} fontSize="11">{i === 0 ? "SOURCE A" : "SOURCE B"}</text>
          <text x="16" y="44" fill={INK} fontSize="16" fontFamily="var(--font-sans)">2 – 1</text>
          <circle cx="112" cy="20" r="5" fill={ACC} stroke={INK} strokeWidth="1" />
        </g>
      ))}
      <path d="M170 60h50v60M170 170h50v-40" fill="none" stroke={INK} strokeWidth={SW} />
      <g transform="translate(205 108)">
        <rect x="0" y="0" width="30" height="30" rx="4" transform="rotate(45 15 15)" fill="white" stroke={INK} strokeWidth={SW} />
        <text x="15" y="19" textAnchor="middle" fill={INK} fontSize="12">=</text>
      </g>
      <path d="M248 123h52" stroke={INK} strokeWidth={SW} strokeDasharray="3 4" />
      <g transform="translate(300 78)">
        <rect width="140" height="90" rx="10" fill="white" stroke={INK} strokeWidth={SW} />
        <text x="16" y="28" fill="var(--color-muted)" letterSpacing="0.06em">RESULT · ONCHAIN</text>
        <text x="16" y="62" fill={INK} fontSize="26" fontFamily="var(--font-sans)" letterSpacing="-0.04em">2 – 1</text>
        <rect x="96" y="44" width="28" height="28" rx="14" fill={ACC} stroke={INK} strokeWidth="1" />
        <path d="M103 58l5 5 9-10" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </g>
      <Label x={370} y={196}>12H CHALLENGE WINDOW</Label>
      <path d="M300 206h140" stroke={MUTED} strokeWidth="3" strokeLinecap="round" />
      <path d="M300 206h58" stroke={ACC} strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/** Many wallets, one verified person. */
export function PersonArt() {
  const wallets = [70, 130, 190];
  return (
    <Frame>
      {wallets.map((y, i) => (
        <g key={y} transform={`translate(48 ${y - 20})`}>
          <rect width="96" height="40" rx="8" fill="white" stroke={INK} strokeWidth={SW} />
          <rect x="12" y="13" width="14" height="14" rx="3" fill={i === 0 ? ACC : "white"} stroke={INK} strokeWidth="1" />
          <rect x="34" y="16" width="48" height="8" rx="2" fill={MUTED} />
        </g>
      ))}
      <Label x={96} y={30}>WALLETS</Label>
      {wallets.map((y) => (
        <path key={y} d={`M144 ${y} C 200 ${y}, 200 130, 250 130`} fill="none" stroke={INK} strokeWidth={SW} />
      ))}
      <g transform="translate(250 82)">
        <circle cx="48" cy="48" r="47" fill="white" stroke={INK} strokeWidth={SW} />
        <circle cx="48" cy="38" r="13" fill="white" stroke={INK} strokeWidth={SW} />
        <path d="M24 78c4-14 14-20 24-20s20 6 24 20" fill="none" stroke={INK} strokeWidth={SW} />
        <circle cx="82" cy="20" r="12" fill={ACC} stroke={INK} strokeWidth="1" />
        <path d="M76 20l4 4 8-8" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </g>
      <Label x={298} y={204}>ONE PERSON · QIE PASS</Label>
      <path d="M346 130h40" stroke={INK} strokeWidth={SW} strokeDasharray="3 4" />
      <g transform="translate(388 112)">
        <rect width="56" height="36" rx="18" fill={INK} />
        <text x="28" y="22" textAnchor="middle" fill="white" fontSize="12" fontFamily="var(--font-sans)">×1</text>
      </g>
    </Frame>
  );
}

/** Sponsor escrow, a Merkle root, hosts claim. */
export function PayoutArt() {
  return (
    <Frame>
      <g transform="translate(36 100)">
        <rect width="92" height="60" rx="8" fill="white" stroke={INK} strokeWidth={SW} />
        <text x="14" y="26" fill={INK} fontSize="11">SPONSOR</text>
        <rect x="14" y="36" width="50" height="8" rx="2" fill={MUTED} />
      </g>
      <path d="M128 130h36" stroke={INK} strokeWidth={SW} />
      <g transform="translate(164 88)">
        <rect width="84" height="84" rx="10" fill={ACC} stroke={INK} strokeWidth={SW} />
        <circle cx="42" cy="42" r="20" fill="white" stroke={INK} strokeWidth={SW} />
        <path d="M42 30v24M30 42h24" stroke={INK} strokeWidth={SW} />
      </g>
      <Label x={206} y={190}>QUSDC ESCROW</Label>
      <path d="M248 130h26" stroke={INK} strokeWidth={SW} />
      <circle cx="290" cy="130" r="12" fill="white" stroke={INK} strokeWidth={SW} />
      <path d="M302 130 L340 82 M302 130 L340 130 M302 130 L340 178" stroke={INK} strokeWidth={SW} />
      {[82, 130, 178].map((y, i) => (
        <g key={y} transform={`translate(340 ${y - 16})`}>
          <rect width="104" height="32" rx="16" fill="white" stroke={INK} strokeWidth={SW} />
          <circle cx="18" cy="16" r="7" fill={i === 1 ? ACC : MUTED} />
          <text x="34" y="20" fill={INK} fontSize="10">HOST {i + 1}</text>
        </g>
      ))}
      <Label x={290} y={110}>ROOT</Label>
    </Frame>
  );
}

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
