import type { ReactNode } from 'react';

const shapes = {
  sidebarCollapse: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18m7-12-3 3 3 3" />
    </>
  ),
  sidebarExpand: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18m4-12 3 3-3 3" />
    </>
  ),
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
  monitor: (
    <>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4M9 3v14m6-14v14M3 10h18" />
    </>
  ),
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
  check: <path d="m5 12 4 4L19 6" />,
  logout: (
    <>
      <path d="M9 3H4v18h5m5-14 5 5-5 5M8 12h12" />
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

export function Brand({ compact = false }: { compact?: boolean } = {}) {
  if (compact) {
    return (
      <svg
        className="brand-lockup brand-lockup-compact"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Beacon"
      >
        <path d="M20 36 L14 15 L26 15 L20 36 Z" fill="#a0a0a0" />
        <rect x="12" y="9" width="16" height="6" rx="1" fill="#254d3a" />
        <circle cx="20" cy="12" r="2" fill="#fff" />
        <path d="M11 36 H29" stroke="#254d3a" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg
      className="brand-lockup"
      viewBox="0 0 150 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Beacon"
    >
      <path d="M30 15 L120 5 L120 25 Z" fill="#b0cabc" opacity="0.7" />
      <path d="M20 35 L15 15 L25 15 L20 35 Z" fill="#a0a0a0" />
      <rect x="13" y="10" width="14" height="5" fill="#333" />
      <circle cx="20" cy="12.5" r="1.5" fill="#fff" />
      <path d="M12 35 L28 35" stroke="#333" strokeWidth="2" />
      <text
        x="35"
        y="28"
        fill="#254d3a"
        fontSize="22"
        fontWeight="800"
        fontFamily="Inter, sans-serif"
      >
        beacon
      </text>
    </svg>
  );
}
