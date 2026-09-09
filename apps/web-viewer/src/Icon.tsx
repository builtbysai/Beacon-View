import { useId, type ReactNode } from 'react';

const shapes = {
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  eyeOff: (
    <>
      <path d="m3 3 18 18M10 5a12 12 0 0 1 2 0c6 0 10 7 10 7a19 19 0 0 1-3 4M6 6a21 21 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4" />
    </>
  ),
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  camera: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.6" />
      <rect x="13" y="3" width="8" height="8" rx="1.6" />
      <rect x="3" y="13" width="8" height="8" rx="1.6" />
      <rect x="13" y="13" width="8" height="8" rx="1.6" />
    </>
  ),
  list: <path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  settings: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" />
      <path d="M8 3v6m8 0v6m-8 0v6" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M10 5h4m-3 14h2" />
    </>
  ),
  browser: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 9h20M5 6.5h.01m3 0h.01" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 4v16M4 12h16" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  alert: (
    <>
      <path d="m12 3 10 18H2Z" />
      <path d="M12 9v5m0 3h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M9 3H4v18h5m5-14 5 5-5 5M8 12h12" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-9.5v.5" />
    </>
  ),
  edit: (
    <>
      <path d="M17 3a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6m4-6v6" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  close: <path d="m5 5 14 14M19 5 5 19" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  micOff: (
    <>
      <path d="m3 3 18 18" />
      <path d="M9 5a3 3 0 0 1 6 0v6c0 .4-.05.78-.15 1.14M15 14.16A3 3 0 0 1 9 12v-1" />
      <path d="M5 11a7 7 0 0 0 10.5 6.06M19 11a7 7 0 0 1-1.05 3.7M12 18v3" />
    </>
  ),
  maximize: (
    <>
      <path d="M9 3H4v5m11-5h5v5M4 16v5h5m11-5v5h-5" />
    </>
  ),
  minimize: (
    <>
      <path d="M4 9h5V4M15 4v5h5M20 15h-5v5M9 20v-5H4" />
    </>
  ),
  signal: (
    <>
      <path d="M4 20v-4m5 4v-8m5 8V8m5 12V4" />
    </>
  ),
  snapshot: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2M4 16v2a2 2 0 0 0 2 2h2m8 0h2a2 2 0 0 0 2-2v-2" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  talk: (
    <>
      <path d="M3 11v2a2 2 0 0 0 2 2h1l3.5 4.5V6.5L6 11H5a2 2 0 0 0-2 2Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof shapes;

export function Icon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}

/**
 * The Beacon "smart lighthouse" camera mark. `useId` namespaces every
 * gradient/filter def so two <Brand> instances can render on one page
 * (the sign-in screen mounts a hero mark and a card mark at once)
 * without one instance's <defs> shadowing the other's.
 */
export function Brand({
  compact = false,
  className = '',
}: { compact?: boolean; className?: string } = {}) {
  const uid = useId().replace(/[:]/g, '');
  const beam = `beacon-beam-${uid}`;
  const hardware = `beacon-hardware-${uid}`;
  const lens = `beacon-lens-${uid}`;
  const glow = `beacon-glow-${uid}`;
  const shadow = `beacon-shadow-${uid}`;

  const mark = (
    <>
      <defs>
        <linearGradient id={hardware} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7c8ba1" />
          <stop offset="100%" stopColor="#293548" />
        </linearGradient>
        <radialGradient id={lens} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="55%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#031525" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="1.5"
            stdDeviation="1.5"
            floodOpacity="0.28"
          />
        </filter>
      </defs>
      <path
        d="M10 38h20"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M 27 7 A 6 6 0 0 1 27 17"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <path
        d="M 32 3 A 11 11 0 0 1 32 21"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.3"
      />
      <g filter={`url(#${shadow})`}>
        <path d="M14 37 L26 37 L23 20 L17 20 Z" fill={`url(#${hardware})`} />
        <rect x="18" y="17" width="4" height="3" fill="#1e293b" />
        <rect
          x="13"
          y="5"
          width="14"
          height="13"
          rx="4.5"
          fill={`url(#${hardware})`}
        />
      </g>
      <circle cx="20" cy="11.5" r="4.5" fill="#0f172a" />
      <circle cx="20" cy="11.5" r="3.5" fill={`url(#${lens})`} />
      <circle cx="20" cy="11.5" r="1" fill="#bae6fd" filter={`url(#${glow})`} />
      <circle
        cx="24"
        cy="7.5"
        r="0.8"
        fill="#f87171"
        filter={`url(#${glow})`}
      />
    </>
  );

  if (compact) {
    return (
      <svg
        className={`brand-mark ${className}`}
        viewBox="6 0 30 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Beacon"
      >
        {mark}
      </svg>
    );
  }

  return (
    <svg
      className={`brand-lockup ${className}`}
      viewBox="0 0 232 45"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Beacon"
    >
      <defs>
        <linearGradient id={beam} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
          <stop offset="12%" stopColor="#0ea5e9" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M20 12 L232 -12 L232 40 Z" fill={`url(#${beam})`} />
      {mark}
      <text
        x="42"
        y="30"
        fontFamily="Inter, -apple-system, system-ui, sans-serif"
        fontSize="21"
        letterSpacing="-0.4"
      >
        <tspan className="brand-word" fontWeight="800">
          Beacon
        </tspan>
      </text>
    </svg>
  );
}
