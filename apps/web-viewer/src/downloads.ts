import type { CameraPower } from './camera-power';

/**
 * Desktop app downloads, self-hosted next to the web app at /downloads/
 * (ADR 0083). The manifest lists only what was actually published, so the
 * site never offers a platform that has no build.
 */
export type DesktopPlatform = 'windows' | 'macos' | 'linux';
export type VisitorPlatform = DesktopPlatform | 'android' | 'ios' | 'other';

export interface DownloadFile {
  arch: 'x64' | 'arm64' | 'universal';
  bytes: number;
  file: string;
  kind: 'installer' | 'dmg' | 'appimage' | 'deb' | 'apk';
  platform: DesktopPlatform | 'android';
  sha256: string;
}

export interface DownloadsManifest {
  files: DownloadFile[];
  publishedAt: string;
  version: string;
}

const FILE_NAME = /^[A-Za-z0-9._-]+$/;

function isDownloadFile(value: unknown): value is DownloadFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    (file.platform === 'windows' ||
      file.platform === 'macos' ||
      file.platform === 'linux' ||
      file.platform === 'android') &&
    (file.arch === 'x64' ||
      file.arch === 'arm64' ||
      file.arch === 'universal') &&
    ['installer', 'dmg', 'appimage', 'deb', 'apk'].includes(
      String(file.kind),
    ) &&
    typeof file.file === 'string' &&
    FILE_NAME.test(file.file) &&
    typeof file.bytes === 'number' &&
    typeof file.sha256 === 'string'
  );
}

export async function loadDownloads(): Promise<DownloadsManifest | null> {
  try {
    const response = await fetch('/downloads/manifest.json', {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const value = (await response.json()) as Partial<DownloadsManifest>;
    if (typeof value.version !== 'string' || !Array.isArray(value.files))
      return null;
    return {
      files: value.files.filter(isDownloadFile),
      publishedAt: String(value.publishedAt ?? ''),
      version: value.version,
    };
  } catch {
    return null;
  }
}

export function downloadUrl(file: DownloadFile): string {
  return `/downloads/${file.file}`;
}

export function detectPlatform(
  userAgent = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): VisitorPlatform {
  if (/android/i.test(userAgent)) return 'android';
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh|mac os x/i.test(userAgent))
    return maxTouchPoints > 1 ? 'ios' : 'macos';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/linux|cros|x11/i.test(userAgent)) return 'linux';
  return 'other';
}

/** The download a visitor on `platform` most likely wants. */
export function primaryDownload(
  manifest: DownloadsManifest | null,
  platform: DesktopPlatform,
): DownloadFile | null {
  const files = manifest?.files.filter((file) => file.platform === platform);
  if (!files?.length) return null;
  const preferredKind = {
    linux: 'appimage',
    macos: 'dmg',
    windows: 'installer',
  }[platform];
  return (
    files.find((file) => file.kind === preferredKind && file.arch === 'x64') ??
    files.find((file) => file.kind === preferredKind) ??
    files[0]!
  );
}

export interface CameraSetup {
  code: string;
  microphone: boolean;
  power: CameraPower;
}

/**
 * A Windows installer downloaded under this name finishes camera setup on
 * first launch: the installer records its own file name and the app reads
 * the token. The `download` attribute sets the name for same-origin files.
 */
export function preconfiguredInstallerName(
  file: DownloadFile,
  setup: CameraSetup,
): string {
  const base = file.file.replace(/\.exe$/i, '');
  return `${base} beacon-camera-${setup.code}-${setup.power}${setup.microphone ? '-mic' : ''}.exe`;
}

export function cameraSetupLink(setup: CameraSetup): string {
  const params = new URLSearchParams({
    code: setup.code,
    mic: setup.microphone ? '1' : '0',
    power: setup.power,
  });
  return `beaconsecureview://camera/setup?${params.toString()}`;
}

/** A small file that sets up Beacon as a camera when opened on a computer
 * with the desktop app installed. It holds only the short-lived, one-time
 * pairing code -- no account credentials. */
export function cameraSetupFile(
  setup: CameraSetup,
  origin = window.location.origin,
): Blob {
  return new Blob(
    [
      JSON.stringify(
        {
          code: setup.code,
          microphone: setup.microphone,
          origin,
          power: setup.power,
          type: 'beacon-camera-setup',
          version: 1,
        },
        null,
        2,
      ),
    ],
    { type: 'application/x-beacon-camera-setup' },
  );
}
