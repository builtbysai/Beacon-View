/**
 * One-click camera setup (ADR 0083). A signed-in household member creates a
 * normal one-time pairing code (10 characters, valid 10 minutes) and hands it
 * to this computer in one of three ways:
 *
 * - a link: beaconsecureview://camera/setup?code=…
 * - a small `.beaconcamera` file, opened by double-click
 * - a pre-configured Windows installer whose file name carries the code
 *   (`Beacon-Setup … beacon-camera-<CODE>-<power>.exe`); the installer
 *   records its own file name and the app finishes setup on first launch
 *
 * All three end in the same place: the web viewer's own pairing page,
 * `/camera-mode/setup?code=…&autostart=1`, which redeems the code exactly as
 * a manual setup would. Nothing here is a credential beyond that short-lived,
 * single-use pairing code.
 */
export type CameraPowerChoice = 'always' | 'standby';

export interface CameraSetupRequest {
  code: string;
  microphone: boolean;
  power: CameraPowerChoice;
}

/** Pairing codes use this alphabet (apps/backend/src/security.ts). */
const PAIRING_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
export const SETUP_FILE_EXTENSION = '.beaconcamera';
export const SETUP_FILE_MAX_BYTES = 4_096;
/** A pending installer setup older than this is stale (the code inside has
 * long expired); it is discarded rather than tried. */
export const PENDING_SETUP_MAX_AGE_MS = 30 * 60 * 1_000;

function power(value: unknown): CameraPowerChoice | null {
  if (value === undefined || value === null) return 'standby';
  return value === 'always' || value === 'standby' ? value : null;
}

function normalizedCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return PAIRING_CODE.test(code) ? code : null;
}

export function parseCameraSetupLink(value: string): CameraSetupRequest | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'beaconsecureview:' ||
    url.host !== 'camera' ||
    (url.pathname !== '/setup' && url.pathname !== '/setup/')
  )
    return null;
  const code = normalizedCode(url.searchParams.get('code'));
  const chosenPower = power(url.searchParams.get('power') ?? undefined);
  if (!code || !chosenPower) return null;
  return {
    code,
    microphone: url.searchParams.get('mic') === '1',
    power: chosenPower,
  };
}

/** Parses a `.beaconcamera` file's text. Its origin must match the origin
 * this app is built for, so a file can never point the app elsewhere. */
export function parseCameraSetupFile(
  text: string,
  appOrigin: string,
): CameraSetupRequest | null {
  if (text.length > SETUP_FILE_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const file = value as Record<string, unknown>;
  const code = normalizedCode(file.code);
  const chosenPower = power(file.power);
  if (
    file.type !== 'beacon-camera-setup' ||
    file.version !== 1 ||
    file.origin !== appOrigin ||
    !code ||
    !chosenPower ||
    (file.microphone !== undefined && typeof file.microphone !== 'boolean')
  )
    return null;
  return { code, microphone: file.microphone === true, power: chosenPower };
}

/** Reads the setup token a browser saved into the installer's file name.
 * Tolerates the " (1)" suffixes browsers add to repeated downloads. */
export function parseInstallerFileName(
  fileName: string,
): CameraSetupRequest | null {
  const match =
    /beacon-camera-([A-Za-z0-9]{10})(?:-(always|standby))?(?:-(mic))?/i.exec(
      fileName,
    );
  if (!match) return null;
  const code = normalizedCode(match[1]);
  if (!code) return null;
  return {
    code,
    microphone: Boolean(match[3]),
    power: match[2]?.toLowerCase() === 'always' ? 'always' : 'standby',
  };
}

/** Where the app sends a setup: the web viewer's own pairing page. */
export function cameraSetupPath(request: CameraSetupRequest): string {
  const params = new URLSearchParams({
    autostart: '1',
    code: request.code,
    mic: request.microphone ? '1' : '0',
    power: request.power,
  });
  return `/camera-mode/setup?${params.toString()}`;
}

const RESUME_PATHS = new Set(['/camera-mode', '/camera-mode/setup']);
const RESUME_PARAMS: Record<string, ReadonlySet<string>> = {
  autostart: new Set(['1']),
  mic: new Set(['0', '1']),
  power: new Set(['always', 'standby']),
};

/** The web viewer asks the app to reopen Camera Mode after a restart. Only
 * Camera Mode paths with known parameters are accepted, and never a code. */
export function validResumePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://resume.invalid');
  } catch {
    return null;
  }
  if (
    url.origin !== 'https://resume.invalid' ||
    !RESUME_PATHS.has(url.pathname)
  )
    return null;
  if (url.searchParams.get('autostart') !== '1') return null;
  for (const [key, paramValue] of url.searchParams) {
    if (!RESUME_PARAMS[key]?.has(paramValue)) return null;
  }
  return `${url.pathname}${url.search}`;
}
