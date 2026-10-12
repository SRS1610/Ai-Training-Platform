import * as React from "react";

/**
 * Colourful inline-SVG spot illustrations for empty states, errors and onboarding.
 * Decorative: always rendered with aria-hidden. Sized via className (default 160px wide).
 */

type IllustrationProps = { className?: string };

function Frame({ children, className, viewBox = "0 0 200 160" }: IllustrationProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} className={className ?? "h-auto w-40"} fill="none" aria-hidden focusable="false">
      {children}
    </svg>
  );
}

function Blob() {
  return (
    <>
      <defs>
        <radialGradient id="ill-blob" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e0e7ff" />
          <stop offset="100%" stopColor="#f5f3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="84" rx="92" ry="70" fill="url(#ill-blob)" />
    </>
  );
}

function Sparkle({ x, y, s = 1, color = "#f59e0b" }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -7 C1 -2 2 -1 7 0 C2 1 1 2 0 7 C-1 2 -2 1 -7 0 C-2 -1 -1 -2 0 -7Z"
      fill={color}
    />
  );
}

/** Stack of colourful books + graduation cap: "start learning". */
export function LearningIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <rect x="46" y="112" width="108" height="16" rx="4" fill="#6366f1" />
      <rect x="46" y="112" width="12" height="16" rx="3" fill="#4338ca" />
      <rect x="54" y="96" width="96" height="16" rx="4" fill="#10b981" />
      <rect x="138" y="96" width="12" height="16" rx="3" fill="#047857" />
      <rect x="40" y="80" width="104" height="16" rx="4" fill="#f59e0b" />
      <rect x="40" y="80" width="12" height="16" rx="3" fill="#b45309" />
      <rect x="62" y="85" width="56" height="3" rx="1.5" fill="#fff" opacity=".7" />
      <rect x="72" y="117" width="56" height="3" rx="1.5" fill="#fff" opacity=".7" />
      <path d="M100 38 L146 56 L100 74 L54 56 Z" fill="#8b5cf6" />
      <path d="M74 64 V72 C74 80 126 80 126 72 V64 L100 74 Z" fill="#6d28d9" />
      <path d="M140 58 V76" stroke="#d946ef" strokeWidth="3" strokeLinecap="round" />
      <circle cx="140" cy="79" r="4" fill="#d946ef" />
      <Sparkle x={34} y={50} />
      <Sparkle x={166} y={40} s={0.8} color="#0ea5e9" />
      <Sparkle x={162} y={104} s={0.6} color="#f43f5e" />
      <circle cx="30" cy="104" r="3" fill="#14b8a6" />
    </Frame>
  );
}

/** Magnifier over cards: "no results". */
export function SearchIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <rect x="38" y="44" width="92" height="22" rx="7" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <circle cx="51" cy="55" r="5" fill="#0ea5e9" />
      <rect x="62" y="51" width="50" height="4" rx="2" fill="#cbd5e1" />
      <rect x="62" y="58" width="32" height="3" rx="1.5" fill="#e2e8f0" />
      <rect x="38" y="74" width="92" height="22" rx="7" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <circle cx="51" cy="85" r="5" fill="#f43f5e" />
      <rect x="62" y="81" width="42" height="4" rx="2" fill="#cbd5e1" />
      <rect x="62" y="88" width="26" height="3" rx="1.5" fill="#e2e8f0" />
      <rect x="38" y="104" width="92" height="22" rx="7" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <circle cx="51" cy="115" r="5" fill="#10b981" />
      <rect x="62" y="111" width="46" height="4" rx="2" fill="#cbd5e1" />
      <circle cx="132" cy="82" r="24" fill="#eef2ff" stroke="#6366f1" strokeWidth="7" />
      <path d="M149 100 L166 118" stroke="#6366f1" strokeWidth="9" strokeLinecap="round" />
      <path d="M122 74 a12 12 0 0 1 14 -4" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <Sparkle x={168} y={52} color="#d946ef" />
      <Sparkle x={30} y={36} s={0.7} />
    </Frame>
  );
}

/** Bell + envelope: "you're all caught up". */
export function InboxIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <rect x="44" y="70" width="112" height="62" rx="12" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M44 82 L100 112 L156 82" stroke="#c7d2fe" strokeWidth="3" fill="none" />
      <path d="M100 30 C84 30 76 42 76 56 V70 L68 80 H132 L124 70 V56 C124 42 116 30 100 30 Z" fill="#f59e0b" />
      <path d="M90 82 a10 10 0 0 0 20 0" fill="#b45309" />
      <rect x="96" y="22" width="8" height="10" rx="4" fill="#d97706" />
      <circle cx="128" cy="38" r="9" fill="#10b981" />
      <path d="M124 38 l3 3 l5 -6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={40} y={44} color="#8b5cf6" />
      <Sparkle x={168} y={66} s={0.7} color="#0ea5e9" />
    </Frame>
  );
}

/** Trophy + ribbon: certificates / achievements. */
export function TrophyIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <path d="M70 36 H130 V64 C130 82 116 94 100 94 C84 94 70 82 70 64 Z" fill="#f59e0b" />
      <path d="M70 44 H56 C56 62 64 70 74 72" stroke="#f59e0b" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M130 44 H144 C144 62 136 70 126 72" stroke="#f59e0b" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M84 44 C84 64 92 76 100 80" stroke="#fde68a" strokeWidth="5" strokeLinecap="round" />
      <rect x="92" y="94" width="16" height="16" fill="#d97706" />
      <rect x="74" y="110" width="52" height="16" rx="5" fill="#6366f1" />
      <rect x="86" y="115" width="28" height="5" rx="2.5" fill="#c7d2fe" />
      <Sparkle x={48} y={30} color="#d946ef" />
      <Sparkle x={154} y={28} s={0.9} color="#0ea5e9" />
      <Sparkle x={158} y={98} s={0.6} color="#10b981" />
      <circle cx="40" cy="96" r="4" fill="#f43f5e" />
    </Frame>
  );
}

/** Rocket: "coming soon" / under construction. */
export function RocketIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <path d="M100 22 C122 36 130 62 126 96 H74 C70 62 78 36 100 22 Z" fill="#6366f1" />
      <path d="M100 22 C110 28 117 38 121 50 H79 C83 38 90 28 100 22 Z" fill="#8b5cf6" />
      <circle cx="100" cy="66" r="11" fill="#e0f2fe" stroke="#fff" strokeWidth="4" />
      <path d="M74 80 L56 102 L76 100 Z" fill="#f43f5e" />
      <path d="M126 80 L144 102 L124 100 Z" fill="#f43f5e" />
      <path d="M86 96 C86 114 100 132 100 132 C100 132 114 114 114 96 Z" fill="#f59e0b" />
      <path d="M93 96 C93 108 100 120 100 120 C100 120 107 108 107 96 Z" fill="#fde68a" />
      <Sparkle x={42} y={44} color="#10b981" />
      <Sparkle x={160} y={40} s={0.8} color="#d946ef" />
      <circle cx="152" cy="120" r="3" fill="#0ea5e9" />
      <circle cx="46" cy="124" r="4" fill="#14b8a6" />
    </Frame>
  );
}

/** Broken plug: errors. */
export function ErrorIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <path d="M20 96 H70" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />
      <rect x="66" y="80" width="30" height="32" rx="8" fill="#6366f1" />
      <rect x="96" y="86" width="12" height="5" rx="2" fill="#475569" />
      <rect x="96" y="101" width="12" height="5" rx="2" fill="#475569" />
      <rect x="120" y="80" width="30" height="32" rx="8" fill="#f43f5e" />
      <path d="M150 96 H182" stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />
      <path d="M112 62 L106 74 L116 72 L110 86" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={60} y={50} color="#0ea5e9" />
      <Sparkle x={154} y={52} s={0.8} color="#d946ef" />
    </Frame>
  );
}

/** Rising bar chart: analytics / no data yet. */
export function ChartIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <rect x="36" y="32" width="128" height="100" rx="14" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <rect x="54" y="92" width="14" height="26" rx="4" fill="#0ea5e9" />
      <rect x="76" y="76" width="14" height="42" rx="4" fill="#10b981" />
      <rect x="98" y="84" width="14" height="34" rx="4" fill="#f59e0b" />
      <rect x="120" y="60" width="14" height="58" rx="4" fill="#8b5cf6" />
      <path d="M52 74 L82 58 L104 66 L140 44" stroke="#f43f5e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="140" cy="44" r="5" fill="#f43f5e" />
      <Sparkle x={170} y={30} color="#d946ef" />
    </Frame>
  );
}

/** Shield with lock: security. */
export function ShieldIllustration({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <Blob />
      <path d="M100 24 L142 40 V76 C142 104 122 122 100 132 C78 122 58 104 58 76 V40 Z" fill="#6366f1" />
      <path d="M100 24 L142 40 V76 C142 104 122 122 100 132 Z" fill="#4f46e5" />
      <rect x="84" y="72" width="32" height="26" rx="6" fill="#fff" />
      <path d="M90 72 V64 a10 10 0 0 1 20 0 V72" stroke="#fff" strokeWidth="5" fill="none" />
      <circle cx="100" cy="84" r="4" fill="#6366f1" />
      <Sparkle x={44} y={46} color="#10b981" />
      <Sparkle x={160} y={102} s={0.8} color="#f59e0b" />
      <circle cx="160" cy="40" r="4" fill="#d946ef" />
    </Frame>
  );
}

export const illustrations = {
  learning: LearningIllustration,
  search: SearchIllustration,
  inbox: InboxIllustration,
  trophy: TrophyIllustration,
  rocket: RocketIllustration,
  error: ErrorIllustration,
  chart: ChartIllustration,
  shield: ShieldIllustration,
} as const;

export type IllustrationName = keyof typeof illustrations;
