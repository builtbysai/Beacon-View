import {
  type DownloadFile,
  type DownloadsManifest,
  primaryDownload,
  type VisitorPlatform,
} from './downloads';
import type { IconName } from './Icon';

/** One way to get Beacon on a kind of device: a download, steps, or the browser itself. */
export interface AppOption {
  id: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'browser';
  title: string;
  icon: IconName;
  /** What the person gets, in a sentence. */
  summary: string;
  /** Something to know before the first run, or why there is no download. */
  note?: string;
  file?: DownloadFile;
  /** The release the file belongs to (the Android app has its own version). */
  version?: string;
  /** A second package for the same system (the Linux .deb). */
  alternate?: DownloadFile;
  /** Steps instead of a file (iPhone and iPad). */
  steps?: string[];
}

/** The version a published file belongs to: the Android app is named after its own. */
export function fileVersion(
  file: DownloadFile,
  manifest: DownloadsManifest,
): string {
  return /^Beacon-android-(.+).apk$/.exec(file.file)?.[1] ?? manifest.version;
}

export function formatSize(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/** Every way to get Beacon that this server actually publishes. */
export function appOptions(manifest: DownloadsManifest | null): AppOption[] {
  const android = manifest?.files.find((file) => file.platform === 'android');
  const linux = primaryDownload(manifest, 'linux');
  const deb = manifest?.files.find(
    (file) => file.platform === 'linux' && file.kind === 'deb',
  );
  const windows = primaryDownload(manifest, 'windows');
  const withVersion = (file: DownloadFile) =>
    manifest ? { file, version: fileVersion(file, manifest) } : { file };
  const mac = primaryDownload(manifest, 'macos');
  return [
    {
      icon: 'browser',
      id: 'windows',
      summary:
        'Runs in the tray, starts with Windows and can be a camera that wakes when you view it.',
      title: 'Windows',
      ...(windows
        ? {
            ...withVersion(windows),
            note: 'The app is not code-signed yet, so Windows may show "More info", then "Run anyway".',
          }
        : { note: 'Not published on this server yet.' }),
    },
    {
      icon: 'browser',
      id: 'macos',
      summary: 'Lives in the menu bar and can be a camera or a viewer.',
      title: 'Mac',
      ...(mac
        ? {
            ...withVersion(mac),
            note: 'The app is not notarized yet: on first launch, Control-click it and choose Open.',
          }
        : { note: 'Not published on this server yet.' }),
    },
    {
      icon: 'browser',
      id: 'linux',
      summary: 'An AppImage that runs on most distributions, plus a .deb.',
      title: 'Linux',
      ...(linux
        ? {
            ...withVersion(linux),
            ...(deb && deb !== linux ? { alternate: deb } : {}),
          }
        : { note: 'Not published on this server yet.' }),
    },
    {
      icon: 'phone',
      id: 'android',
      summary:
        'Turns a spare phone or tablet into a camera that keeps running with the screen off, and watches your cameras.',
      title: 'Android',
      ...(android
        ? {
            ...withVersion(android),
            note: 'Android asks you to allow installs from your browser for this one file. Updates are installed the same way for now.',
          }
        : { note: 'The Android app is in private alpha.' }),
    },
    {
      icon: 'phone',
      id: 'ios',
      steps: [
        'Open this page in Safari.',
        'Tap Share, then Add to Home Screen.',
        'Open Beacon from your Home Screen.',
      ],
      summary:
        'Watch your cameras and get alerts (iOS 16.4 or later). An iPhone or iPad can also be a camera while it stays awake and plugged in.',
      title: 'iPhone & iPad',
    },
    {
      icon: 'browser',
      id: 'browser',
      summary:
        'Nothing to install: any modern browser can watch cameras or be one.',
      title: 'Any browser',
    },
  ];
}

/** The option for the visitor's own device, if there is one; everything else is "other ways". */
export function splitForVisitor(
  options: AppOption[],
  visitor: VisitorPlatform,
): { primary: AppOption; others: AppOption[] } {
  const id: AppOption['id'] =
    visitor === 'other' || visitor === 'ios'
      ? visitor === 'ios'
        ? 'ios'
        : 'browser'
      : visitor;
  const primary = options.find((option) => option.id === id) ?? options.at(-1)!;
  return { others: options.filter((option) => option !== primary), primary };
}
