import { useEffect, useState } from 'react';

import {
  type AppOption,
  appOptions,
  formatSize,
  splitForVisitor,
} from './app-downloads';
import {
  detectPlatform,
  downloadUrl,
  type DownloadsManifest,
  loadDownloads,
} from './downloads';
import { Icon } from './Icon';
import { usePwaInstall } from './pwa-install';
import './AppDownloads.css';

const KIND_LABEL: Record<string, string> = {
  apk: 'Android app',
  appimage: 'AppImage',
  deb: '.deb package',
  dmg: 'disk image',
  installer: 'installer',
};

function Download({
  option,
  primary,
}: {
  option: AppOption;
  primary: boolean;
}) {
  if (!option.file) return null;
  return (
    <a
      className={`btn ${primary ? 'primary' : 'secondary'}`}
      download
      href={downloadUrl(option.file)}
    >
      <Icon name="download" /> Download{primary ? ` for ${option.title}` : ''}
    </a>
  );
}

function Details({ option }: { option: AppOption }) {
  const file = option.file;
  if (!file) return null;
  return (
    <>
      <p className="app-downloads-meta">
        {option.version && `Version ${option.version} · `}
        {KIND_LABEL[file.kind] ?? file.kind} · {formatSize(file.bytes)}
        {option.alternate && (
          <>
            {' '}
            · <a href={downloadUrl(option.alternate)}>.deb package</a>
          </>
        )}
      </p>
      <details className="app-downloads-verify">
        <summary>Verify this download</summary>
        <p>
          SHA-256 of <code>{file.file}</code>
        </p>
        <code className="app-downloads-hash">{file.sha256}</code>
      </details>
    </>
  );
}

/**
 * Where to get Beacon (ADR 0118): the option for this device first and large, every other way as a short
 * list. Used on the landing page, in Settings, and wherever someone might want the app. Only builds this
 * server actually publishes get a download button.
 */
export function AppDownloads({
  onOpenWeb,
  variant,
}: {
  onOpenWeb?: () => void;
  variant: 'landing' | 'app';
}) {
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  const [visitor] = useState(() => detectPlatform());
  const pwa = usePwaInstall();
  useEffect(() => {
    void loadDownloads().then(setManifest);
  }, []);

  const options = appOptions(manifest).filter(
    // Inside the app, "any browser" is where you already are.
    (option) => variant === 'landing' || option.id !== 'browser',
  );
  const { others, primary } = splitForVisitor(options, visitor);
  const loading = manifest === null;

  return (
    <div className={`app-downloads app-downloads-${variant}`}>
      <article className="app-downloads-primary">
        <div className="app-downloads-head">
          <Icon name={primary.icon} />
          <h3>
            {primary.id === 'browser'
              ? 'Use Beacon in your browser'
              : `Beacon for ${primary.title}`}
          </h3>
          <span className="app-downloads-tag">This device</span>
        </div>
        <p>{primary.summary}</p>
        {primary.steps && (
          <ol className="app-downloads-steps">
            {primary.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {primary.id === 'browser' && onOpenWeb && (
          <button className="btn primary" onClick={onOpenWeb} type="button">
            Open Beacon
          </button>
        )}
        {primary.file ? (
          <>
            <Download option={primary} primary />
            <Details option={primary} />
          </>
        ) : (
          !primary.steps &&
          primary.id !== 'browser' && (
            <p className="app-downloads-meta">
              {loading ? 'Checking what is published…' : primary.note}
            </p>
          )
        )}
        {primary.file && primary.note && (
          <p className="app-downloads-note">{primary.note}</p>
        )}
        {variant === 'app' && pwa.available && (
          <button className="btn secondary" onClick={pwa.install} type="button">
            Install Beacon as an app from this browser
          </button>
        )}
      </article>

      <div className="app-downloads-others">
        <h3>Other ways to get Beacon</h3>
        <ul>
          {others.map((option) => (
            <li className="app-downloads-row" key={option.id}>
              <Icon name={option.icon} />
              <div className="app-downloads-row-copy">
                <b>{option.title}</b>
                <span>
                  {option.file
                    ? `${KIND_LABEL[option.file.kind] ?? option.file.kind} · ${formatSize(option.file.bytes)}`
                    : option.steps
                      ? 'Add to Home Screen'
                      : option.id === 'browser'
                        ? 'No install'
                        : loading
                          ? 'Checking…'
                          : (option.note ?? '')}
                </span>
                {option.steps && (
                  <details>
                    <summary>How</summary>
                    <ol>
                      {option.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              {option.file ? (
                <Download option={option} primary={false} />
              ) : (
                option.id === 'browser' &&
                onOpenWeb && (
                  <button
                    className="btn secondary"
                    onClick={onOpenWeb}
                    type="button"
                  >
                    Open
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
