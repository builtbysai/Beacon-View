import { useEffect, useState } from 'react';

import {
  detectPlatform,
  type DownloadFile,
  downloadUrl,
  type DownloadsManifest,
  loadDownloads,
  primaryDownload,
  type VisitorPlatform,
} from './downloads';
import { Icon, type IconName } from './Icon';

function size(file: DownloadFile): string {
  return `${Math.round(file.bytes / 1_000_000)} MB`;
}

interface PlatformCard {
  id: VisitorPlatform;
  icon: IconName;
  title: string;
  body: React.ReactNode;
}

/** "Get Beacon on every device" on the landing page (ADR 0083). Desktop
 * downloads come from the self-hosted manifest, so only builds that were
 * actually published are offered. */
export function GetBeaconSection({ onOpenWeb }: { onOpenWeb: () => void }) {
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  const [visitor] = useState(() => detectPlatform());

  useEffect(() => {
    void loadDownloads().then(setManifest);
  }, []);

  function desktop(
    platform: 'windows' | 'macos' | 'linux',
    note: string,
  ): React.ReactNode {
    const file = primaryDownload(manifest, platform);
    if (!file)
      return (
        <p className="get-note">
          {manifest ? 'Not published on this server yet.' : 'Checking…'}
        </p>
      );
    const deb =
      platform === 'linux'
        ? manifest?.files.find(
            (item) => item.platform === 'linux' && item.kind === 'deb',
          )
        : undefined;
    return (
      <>
        <a className="btn primary" download href={downloadUrl(file)}>
          <Icon name="download" /> Download
        </a>
        <p className="get-note">
          Version {manifest!.version} · {size(file)}
          {deb && (
            <>
              {' '}
              · <a href={downloadUrl(deb)}>.deb package</a>
            </>
          )}
        </p>
        <p className="get-note">{note}</p>
      </>
    );
  }

  const android = manifest?.files.find(
    (file) => (file.platform as string) === 'android',
  );
  const cards: PlatformCard[] = [
    {
      body: desktop(
        'windows',
        'Runs in the tray, starts with Windows, and can be a camera.',
      ),
      icon: 'browser',
      id: 'windows',
      title: 'Windows',
    },
    {
      body: desktop(
        'macos',
        'First launch: Control-click the app and choose Open (the build isn’t notarized yet).',
      ),
      icon: 'browser',
      id: 'macos',
      title: 'Mac',
    },
    {
      body: desktop('linux', 'AppImage runs on most distributions.'),
      icon: 'browser',
      id: 'linux',
      title: 'Linux',
    },
    {
      body: android ? (
        <a className="btn primary" href={downloadUrl(android)}>
          <Icon name="download" /> Download
        </a>
      ) : (
        <>
          <p className="get-note">
            The Android app is in private alpha — the best way to turn a spare
            phone into a camera.
          </p>
          <a className="btn secondary" href="/contact">
            Request access
          </a>
        </>
      ),
      icon: 'phone',
      id: 'android',
      title: 'Android',
    },
    {
      body: (
        <p className="get-note">
          Open Beacon in Safari, tap Share, then <b>Add to Home Screen</b>.
          Watch your cameras and get alerts (iOS 16.4 or later).
        </p>
      ),
      icon: 'phone',
      id: 'ios',
      title: 'iPhone & iPad',
    },
    {
      body: (
        <>
          <button className="btn secondary" onClick={onOpenWeb} type="button">
            Open Beacon
          </button>
          <p className="get-note">
            Nothing to install. Any modern browser can view cameras or be one.
          </p>
        </>
      ),
      icon: 'browser',
      id: 'other',
      title: 'Any browser',
    },
  ];
  // The visitor's own platform comes first.
  const ordered = [
    ...cards.filter((card) => card.id === visitor),
    ...cards.filter((card) => card.id !== visitor),
  ];

  return (
    <section className="section get-beacon" id="download">
      <div className="wrap">
        <div className="section-head">
          <p>Get Beacon</p>
          <h2>On every device you have.</h2>
          <p className="sub">
            Use the same account everywhere. Computers and phones can watch your
            cameras or become one.
          </p>
        </div>
        <div className="get-grid">
          {ordered.map((card) => (
            <article
              className={`get-card${card.id === visitor ? ' is-current' : ''}`}
              key={card.id}
            >
              <div className="get-card-head">
                <Icon name={card.icon} />
                <h3>{card.title}</h3>
                {card.id === visitor && (
                  <span className="get-tag">This device</span>
                )}
              </div>
              {card.body}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
