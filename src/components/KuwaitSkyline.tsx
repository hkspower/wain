/**
 * Illustrated Kuwait skyline used as the hero backdrop.
 * Pure inline SVG so it stays crisp at any width and ships with the
 * static export (no external image requests).
 */
export default function KuwaitSkyline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMax slice"
      role="presentation"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wain-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdfaf3" />
          <stop offset="45%" stopColor="#fbeed6" />
          <stop offset="100%" stopColor="#f6dfb4" />
        </linearGradient>
        <linearGradient id="wain-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fc0ea" />
          <stop offset="100%" stopColor="#2f96d6" />
        </linearGradient>
        <radialGradient id="wain-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fccb4d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fccb4d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wain-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fffefb" />
          <stop offset="100%" stopColor="#e4d0a6" />
        </linearGradient>
      </defs>

      {/* Buildings share a soft warm outline so they read against the sky */}
      <style>{`
        .bldg { stroke: #c9ab72; stroke-width: 2.5; stroke-linejoin: round; }
        .spire { stroke: #c9ab72; stroke-width: 2; stroke-linejoin: round; }
        .orb { stroke: #1f7fb8; stroke-width: 2.5; }
      `}</style>

      {/* Sky */}
      <rect width="1200" height="420" fill="url(#wain-sky)" />
      <circle cx="600" cy="250" r="300" fill="url(#wain-glow)" />

      {/* Clouds */}
      <g className="animate-drift" fill="#ffffff" opacity="0.9">
        <g>
          <ellipse cx="150" cy="70" rx="52" ry="24" />
          <ellipse cx="196" cy="74" rx="34" ry="18" />
          <ellipse cx="110" cy="78" rx="30" ry="16" />
        </g>
        <g opacity="0.75">
          <ellipse cx="1010" cy="58" rx="46" ry="21" />
          <ellipse cx="1052" cy="63" rx="30" ry="15" />
        </g>
        <g opacity="0.6">
          <ellipse cx="700" cy="42" rx="38" ry="17" />
          <ellipse cx="732" cy="46" rx="24" ry="12" />
        </g>
      </g>

      {/* Birds */}
      <g
        stroke="#4e483f"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      >
        <path d="M880 96 q9 -8 18 0" />
        <path d="M904 82 q8 -7 16 0" />
        <path d="M926 100 q7 -6 14 0" />
      </g>

      {/* ---- Skyline ---- */}

      {/* Liberation Tower */}
      <g>
        <path className="bldg" d="M172 372 L182 150 L192 150 L202 372 Z" fill="url(#wain-stone)" />
        <path className="spire" d="M182 150 L187 44 L192 150 Z" fill="#efe0c2" />
        <circle cx="187" cy="40" r="5" fill="#dc2f25" />
        <ellipse cx="187" cy="168" rx="26" ry="11" fill="#2f8a4e" />
        <ellipse cx="187" cy="206" rx="20" ry="9" fill="#e6d7ba" />
        <rect x="176" y="240" width="22" height="8" rx="4" fill="#e6d7ba" />
      </g>

      {/* Low city block, left */}
      <g fill="url(#wain-stone)">
        <rect className="bldg" x="238" y="286" width="70" height="86" rx="6" />
        <rect className="bldg" x="316" y="312" width="52" height="60" rx="6" />
      </g>
      <g fill="#dcc287" opacity="0.5">
        <rect x="250" y="300" width="10" height="12" rx="2" />
        <rect x="268" y="300" width="10" height="12" rx="2" />
        <rect x="286" y="300" width="10" height="12" rx="2" />
        <rect x="250" y="326" width="10" height="12" rx="2" />
        <rect x="268" y="326" width="10" height="12" rx="2" />
        <rect x="286" y="326" width="10" height="12" rx="2" />
      </g>

      {/* Grand Mosque */}
      <g>
        <rect className="bldg" x="404" y="292" width="168" height="80" rx="8" fill="url(#wain-stone)" />
        <path className="bldg" d="M488 208 q52 26 52 84 h-104 q0 -58 52 -84 Z" fill="#ecd9b0" />
        <circle cx="488" cy="204" r="7" fill="#c9a55f" />
        <path d="M488 197 v-12" stroke="#c9a55f" strokeWidth="3" strokeLinecap="round" />
        {/* Minaret */}
        <rect className="bldg" x="586" y="176" width="18" height="196" rx="5" fill="url(#wain-stone)" />
        <path d="M586 176 h18 l-9 -22 Z" fill="#2f8a4e" />
        <rect x="583" y="212" width="24" height="7" rx="3.5" fill="#dcc287" />
        {/* Arches */}
        <g fill="#f3e7d0">
          <path d="M424 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
          <path d="M466 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
          <path d="M508 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
        </g>
      </g>

      {/* Kuwait Towers */}
      <g>
        {/* Third, bare spire */}
        <path className="bldg" d="M804 372 L812 150 L818 150 L826 372 Z" fill="url(#wain-stone)" />
        <path className="spire" d="M812 150 L815 96 L818 150 Z" fill="#efe0c2" />

        {/* Second tower, one sphere */}
        <path className="bldg" d="M744 372 L753 172 L761 172 L770 372 Z" fill="url(#wain-stone)" />
        <path className="spire" d="M753 172 L757 104 L761 172 Z" fill="#efe0c2" />
        <circle className="orb" cx="757" cy="196" r="30" fill="url(#wain-sea)" />
        <g fill="#ffffff" opacity="0.75">
          <circle cx="746" cy="188" r="3.4" />
          <circle cx="759" cy="184" r="3.4" />
          <circle cx="770" cy="192" r="3.4" />
          <circle cx="750" cy="203" r="3.4" />
          <circle cx="763" cy="200" r="3.4" />
        </g>

        {/* Main tower, two spheres */}
        <path className="bldg" d="M666 372 L678 130 L690 130 L702 372 Z" fill="url(#wain-stone)" />
        <path className="spire" d="M678 130 L684 34 L690 130 Z" fill="#efe0c2" />
        <circle className="orb" cx="684" cy="96" r="22" fill="url(#wain-sea)" />
        <circle className="orb" cx="684" cy="176" r="46" fill="url(#wain-sea)" />
        <g fill="#ffffff" opacity="0.75">
          <circle cx="666" cy="162" r="4.6" />
          <circle cx="686" cy="155" r="4.6" />
          <circle cx="704" cy="166" r="4.6" />
          <circle cx="670" cy="184" r="4.6" />
          <circle cx="690" cy="180" r="4.6" />
          <circle cx="706" cy="192" r="4.6" />
          <circle cx="676" cy="204" r="4.6" />
          <circle cx="696" cy="207" r="4.6" />
          <circle cx="676" cy="88" r="3.6" />
          <circle cx="692" cy="93" r="3.6" />
          <circle cx="683" cy="104" r="3.6" />
        </g>
      </g>

      {/* Seif Palace clock tower */}
      <g>
        <rect className="bldg" x="1006" y="252" width="86" height="120" rx="7" fill="url(#wain-stone)" />
        <rect className="bldg" x="1028" y="180" width="42" height="76" rx="6" fill="url(#wain-stone)" />
        <path d="M1028 180 h42 l-21 -40 Z" fill="#1f6f3d" />
        <circle cx="1049" cy="212" r="14" fill="#faf4e6" stroke="#c9a55f" strokeWidth="3" />
        <path
          d="M1049 212 v-8 M1049 212 h6"
          stroke="#35302a"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <g fill="#f3e7d0">
          <path d="M1020 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
          <path d="M1056 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
        </g>
      </g>

      {/* Low block, right */}
      <g fill="url(#wain-stone)">
        <rect className="bldg" x="900" y="300" width="76" height="72" rx="6" />
      </g>
      <g fill="#dcc287" opacity="0.45">
        <rect x="914" y="314" width="10" height="12" rx="2" />
        <rect x="932" y="314" width="10" height="12" rx="2" />
        <rect x="950" y="314" width="10" height="12" rx="2" />
      </g>

      {/* Palms */}
      {[
        { x: 92, s: 1 },
        { x: 356, s: 0.82 },
        { x: 620, s: 0.7 },
        { x: 862, s: 0.9 },
        { x: 1156, s: 1.02 },
      ].map((palm) => (
        <g key={palm.x} transform={`translate(${palm.x} 372) scale(${palm.s})`}>
          <path d="M0 0 q-4 -34 2 -62" stroke="#8b6836" strokeWidth="7" fill="none" strokeLinecap="round" />
          <g fill="#2f8a4e">
            <path d="M2 -62 q-30 -8 -42 10 q24 -4 42 -2 Z" />
            <path d="M2 -62 q30 -10 44 8 q-26 -4 -44 -2 Z" />
            <path d="M2 -62 q-16 -26 -40 -26 q22 12 36 28 Z" />
            <path d="M2 -62 q18 -26 42 -24 q-24 10 -38 27 Z" />
            <path d="M2 -62 q2 -26 -8 -40 q14 12 14 38 Z" />
          </g>
          <circle cx="2" cy="-60" r="4" fill="#1b5832" />
        </g>
      ))}

      {/* Ground */}
      <rect y="368" width="1200" height="52" fill="#267943" />
      <rect y="368" width="1200" height="9" fill="#4ba368" />

      {/* Kuwait flag */}
      <g transform="translate(548 300)">
        <rect x="-2" y="0" width="4" height="72" rx="2" fill="#8b6836" />
        <g>
          <rect x="2" y="2" width="54" height="10" fill="#2f8a4e" />
          <rect x="2" y="12" width="54" height="10" fill="#fdfaf3" />
          <rect x="2" y="22" width="54" height="10" fill="#dc2f25" />
          <path d="M2 2 L22 12 L22 22 L2 32 Z" fill="#14120f" />
        </g>
      </g>
    </svg>
  );
}
