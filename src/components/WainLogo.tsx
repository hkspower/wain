/**
 * The Wain mark: a stylised Kuwait silhouette with a pin planted at Kuwait
 * City, the pin's head carrying the ؟ of «وين؟». Master artwork lives in
 * public/brand/wain-logo.svg — keep the two in sync.
 */
export default function WainLogo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="14 8 84 92" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wl-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#57b0e3" />
          <stop offset="1" stopColor="#2277b4" />
        </linearGradient>
        <linearGradient id="wl-coral" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4d43" />
          <stop offset="1" stopColor="#b9241b" />
        </linearGradient>
      </defs>
      <path
        d="M 31 24 Q 27.4 24.4 27.2 28 L 25.2 78 Q 25 82 28.8 82.8 L 70 90.5 Q 74 91.2 75.8 87.6 L 84.6 70 Q 86 66.8 84.6 63.6 L 79.6 53.4 Q 78 50 74.2 50.6 L 66.5 51.7 Q 61 52.5 61 47.8 Q 61 43.4 66.5 43 L 72.8 42.6 Q 76.6 42.3 77.6 38.6 L 79.6 31.4 Q 80.4 28.6 83 27.2 L 86.4 25.4 Q 89.6 23.6 88.2 20.4 Q 86.9 17.4 83.6 18 L 74.4 19.6 Q 72.4 20 70.4 20.2 L 31 24 Z"
        fill="url(#wl-sea)"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M 58 54.5 C 50.5 44 45.5 38.5 45.5 30 C 45.5 22 51 16.5 58 16.5 C 65 16.5 70.5 22 70.5 30 C 70.5 38.5 65.5 44 58 54.5 Z"
        fill="url(#wl-coral)"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <g
        transform="translate(58 28) scale(-1 1)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M -4.4 -4.2 A 4.9 4.9 0 1 1 0 1.9 L 0 3.6" />
      </g>
      <circle cx="58" cy="36.8" r="2" fill="#ffffff" />
    </svg>
  );
}
