import type { ReactNode } from 'react';

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
  shieldOff: (
    <>
      <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" />
      <path d="M4 4 20 20" />
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
  flip: (
    <>
      <path d="M17 2 21 6l-4 4" />
      <path d="M3 12v-2a4 4 0 0 1 4-4h14" />
      <path d="M7 22 3 18l4-4" />
      <path d="M21 12v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.5-2L20 12M4 12l2.4 5a7 7 0 0 0 11.5-2" />
    </>
  ),
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
  speaker: (
    <>
      <path d="M3 10v4a2 2 0 0 0 2 2h2l4 4V4l-4 4H5a2 2 0 0 0-2 2Z" />
      <path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
    </>
  ),
  speakerOff: (
    <>
      <path d="m3 3 18 18M10 8 11 7v10l-4-4H5a2 2 0 0 1-2-2V9" />
      <path d="M16 9a4 4 0 0 1 1 2.5M19 6a8 8 0 0 1 1 6" />
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
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.2-4 4.4-6 8-6s6.8 2 8 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20c1-3.4 3.6-5.2 6.5-5.2s5.5 1.8 6.5 5.2" />
      <path d="M16 4.6a3.4 3.4 0 0 1 0 6.7M19 14.4c2 .6 3.5 2.3 4.2 5.6" />
    </>
  ),
  cloud: (
    <path d="M7 18a4.5 4.5 0 0 1-.5-8.98A5.5 5.5 0 0 1 17.4 8 4 4 0 0 1 17 18H7Z" />
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

/** The Beacon lens-and-signal mark: visible capture at the center, with
 * symmetric connection waves and a stable base. It stays legible at favicon
 * size and uses the same geometry as the Android adaptive icon. */
export function Brand({
  compact = false,
  className = '',
}: { compact?: boolean; className?: string } = {}) {
  const mark = (
    <>
      <path
        d="M11 11.5C5.5 16.2 5.5 23.8 11 28.5M33 11.5c5.5 4.7 5.5 12.3 0 17"
        stroke="#38bdf8"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M15 15.5c-2.8 2.5-2.8 6.5 0 9M29 15.5c2.8 2.5 2.8 6.5 0 9"
        stroke="#7dd3fc"
        strokeWidth="2.3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="22" cy="20" r="9" fill="#0ea5e9" />
      <circle cx="22" cy="20" r="5.2" fill="#071b31" />
      <circle cx="22" cy="20" r="2" fill="#e0f2fe" />
      <path
        d="M22 29v7M15 38h14"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </>
  );

  if (compact) {
    return (
      <svg
        className={`brand-mark ${className}`}
        viewBox="0 0 44 44"
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
      viewBox="0 0 232 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Beacon"
    >
      {mark}
      <text
        x="50"
        y="29"
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
