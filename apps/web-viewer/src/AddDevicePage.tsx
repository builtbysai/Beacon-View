import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { androidApp } from './android-shell';
import { request } from './api';
import { browserCameraSetupLink, pairingLink } from './app-navigation';
import { ComputerSetupPanel } from './ComputerCameraSetupDialog';
import { desktopBridge } from './desktop-shell';
import {
  detectPlatform,
  downloadUrl,
  type DownloadsManifest,
  loadDownloads,
  primaryDownload,
} from './downloads';
import { Icon, type IconName } from './Icon';
import { useAndroidApp } from './use-android-app';
import { usePairingCode } from './use-pairing-code';
import './AddDevicePage.css';

type Kind = 'this' | 'mobile' | 'computer';

const KINDS: Array<{
  description: string;
  icon: IconName;
  id: Kind;
  title: string;
}> = [
  {
    description: 'The one in your hands right now.',
    icon: 'browser',
    id: 'this',
    title: 'This device',
  },
  {
    description: 'A spare Android or iPhone, or an iPad.',
    icon: 'phone',
    id: 'mobile',
    title: 'Phone or tablet',
  },
  {
    description: 'A spare Windows, Mac or Linux computer.',
    icon: 'download',
    id: 'computer',
    title: 'Computer',
  },
];

/**
 * Add a device (ADR 0117). One question first, "which device will be the camera?", then the steps for
 * that device on the same page. A computer, a phone and the device in your hands are all just devices;
 * only the steps differ.
 */
export function AddDevicePage({
  onBack,
  onUseBrowser,
}: {
  onBack: () => void;
  onUseBrowser: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  useEffect(() => {
    void loadDownloads().then(setManifest);
  }, []);

  return (
    <div className="add-device-page">
      <button className="add-device-back" onClick={onBack} type="button">
        &larr; Back to Home
      </button>

      <div className="add-device-intro">
        <h1>Add a device</h1>
        <p>Which device will be the camera? We’ll walk you through the rest.</p>
      </div>

      <div
        aria-label="Which device will be the camera?"
        className="add-device-kinds"
        role="radiogroup"
      >
        {KINDS.map((option) => (
          <button
            aria-checked={kind === option.id}
            className={`add-device-kind${kind === option.id ? ' is-selected' : ''}`}
            key={option.id}
            onClick={() => setKind(option.id)}
            role="radio"
            type="button"
          >
            <span className="add-device-ico">
              <Icon name={option.icon} />
            </span>
            <span className="add-device-kind-copy">
              <b>{option.title}</b>
              <span>{option.description}</span>
            </span>
          </button>
        ))}
      </div>

      <div aria-live="polite" className="add-device-panel-region">
        {kind === 'this' && (
          <ThisDevicePanel manifest={manifest} onUseBrowser={onUseBrowser} />
        )}
        {kind === 'mobile' && <MobilePanel manifest={manifest} />}
        {kind === 'computer' && (
          <section className="add-device-panel" aria-label="Computer">
            <ComputerSetupPanel embedded onClose={() => setKind(null)} />
          </section>
        )}
      </div>

      <p className="add-device-note">
        <Icon name="alert" /> Only connect or use devices you own or are
        authorized to access.
      </p>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="add-device-steps">{children}</ol>;
}

function ThisDevicePanel({
  manifest,
  onUseBrowser,
}: {
  manifest: DownloadsManifest | null;
  onUseBrowser: () => void;
}) {
  const platform = detectPlatform();
  const inDesktopApp = desktopBridge() !== null;
  const { camera: phoneCamera, inApp: inAndroidApp } = useAndroidApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  /** In the Android app the camera is native: make a one-time code with this signed-in session and hand it over. */
  async function startPhoneCamera() {
    setStartError('');
    setStarting(true);
    try {
      if (phoneCamera?.paired) {
        await androidApp.openCameraScreen();
      } else {
        const { code } = await request<{ code: string }>('/api/pairing-codes', {
          body: '{}',
          method: 'POST',
        });
        await androidApp.startCamera(code);
      }
    } catch {
      setStartError('The camera could not be started. Try again.');
    } finally {
      setStarting(false);
    }
  }
  const computer =
    platform === 'windows' || platform === 'macos' || platform === 'linux'
      ? platform
      : null;
  const installer = computer ? primaryDownload(manifest, computer) : null;
  const android = manifest?.files.find((file) => file.platform === 'android');
  return (
    <section className="add-device-panel" aria-label="This device">
      <h2>Use this device as a camera</h2>
      <p>
        {inAndroidApp
          ? 'Beacon uses this phone’s camera, keeps it ready with the screen off, and shows a clear indicator whenever it is on.'
          : 'Beacon uses the camera on this device while this page stays open, and shows a clear indicator whenever it is on.'}
      </p>
      <div className="add-device-actions">
        <button
          className="btn primary"
          disabled={starting}
          onClick={inAndroidApp ? () => void startPhoneCamera() : onUseBrowser}
          type="button"
        >
          {inAndroidApp && phoneCamera?.paired
            ? 'Open the camera'
            : 'Start the camera'}
        </button>
      </div>
      {startError && (
        <p className="add-device-error" role="alert">
          {startError}
        </p>
      )}
      {!inDesktopApp && !inAndroidApp && installer && (
        <div className="add-device-aside">
          <h3>Want it to keep running?</h3>
          <p>
            A browser tab has to stay open. The Beacon app runs in the
            background, starts with this computer and wakes when someone views
            the camera.
          </p>
          <a className="btn secondary" download href={downloadUrl(installer)}>
            <Icon name="download" /> Get Beacon for{' '}
            {computer === 'windows'
              ? 'Windows'
              : computer === 'macos'
                ? 'Mac'
                : 'Linux'}
          </a>
        </div>
      )}
      {platform === 'android' && !inAndroidApp && android && (
        <div className="add-device-aside">
          <h3>Want it to keep running?</h3>
          <p>
            The Beacon app keeps the camera ready with the screen off and
            reconnects by itself.
          </p>
          <a className="btn secondary" download href={downloadUrl(android)}>
            <Icon name="download" /> Get Beacon for Android
          </a>
        </div>
      )}
    </section>
  );
}

type MobileKind = 'android' | 'ios';

function MobilePanel({ manifest }: { manifest: DownloadsManifest | null }) {
  const [mobile, setMobile] = useState<MobileKind>(() =>
    detectPlatform() === 'ios' ? 'ios' : 'android',
  );
  const pairing = usePairingCode(true);
  const android = manifest?.files.find((file) => file.platform === 'android');
  const [copied, setCopied] = useState(false);
  const link =
    mobile === 'android'
      ? pairing.code && pairingLink(pairing.code)
      : pairing.code && browserCameraSetupLink(pairing.code);

  const code = pairing.error ? (
    <p className="add-device-error" role="alert">
      {pairing.error}{' '}
      <button className="btn secondary" onClick={pairing.create} type="button">
        Try again
      </button>
    </p>
  ) : pairing.expired ? (
    <p className="add-device-expired" role="status">
      This code expired. Codes last 10 minutes for your security.{' '}
      <button className="btn primary" onClick={pairing.create} type="button">
        Get a new code
      </button>
    </p>
  ) : pairing.code ? (
    <div className="add-device-code">
      <QRCodeSVG
        aria-label="Beacon pairing QR code"
        bgColor="#ffffff"
        fgColor="#101820"
        level="M"
        marginSize={0}
        size={148}
        title="Scan with the camera device"
        value={link}
      />
      <div>
        <span className="add-device-code-label">One-time code</span>
        <b className="add-device-code-value">{pairing.code}</b>
        <span className="add-device-code-expiry">
          Expires in {pairing.remaining}
        </span>
        <button
          className="btn secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          type="button"
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </div>
  ) : (
    <p className="add-device-wait">Preparing your code…</p>
  );

  return (
    <section className="add-device-panel" aria-label="Phone or tablet">
      <div
        aria-label="Phone or tablet type"
        className="add-device-segments"
        role="radiogroup"
      >
        {(
          [
            ['android', 'Android phone or tablet'],
            ['ios', 'iPhone or iPad'],
          ] as const
        ).map(([id, label]) => (
          <button
            aria-checked={mobile === id}
            className={mobile === id ? 'is-selected' : ''}
            key={id}
            onClick={() => {
              setMobile(id);
              setCopied(false);
            }}
            role="radio"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {mobile === 'android' ? (
        <Steps>
          <li>
            <h3>Install Beacon on the phone</h3>
            {android ? (
              <div className="add-device-install">
                <QRCodeSVG
                  aria-label="Android download QR code"
                  bgColor="#ffffff"
                  fgColor="#101820"
                  level="M"
                  marginSize={0}
                  size={96}
                  value={new URL(
                    downloadUrl(android),
                    window.location.origin,
                  ).toString()}
                />
                <div>
                  <a
                    className="btn secondary"
                    download
                    href={downloadUrl(android)}
                  >
                    <Icon name="download" /> Download for Android
                  </a>
                  <p>
                    Scan this with the phone, or open this page on it. When
                    Android asks, allow installs from your browser for this one
                    file.
                  </p>
                </div>
              </div>
            ) : (
              <p>The Android app isn’t published on this server yet.</p>
            )}
          </li>
          <li>
            <h3>Pair it</h3>
            <p>
              Open Beacon, choose <b>Set up this device as a camera</b>, then
              scan this code or type it.
            </p>
            {code}
          </li>
          <li>
            <h3>Done</h3>
            <p>
              When the phone connects, this page takes you to Cameras. You can
              name it there.
            </p>
          </li>
        </Steps>
      ) : (
        <Steps>
          <li>
            <h3>Open Beacon on the iPhone or iPad</h3>
            <p>
              Scan this code with its camera, or send yourself the link. It
              opens Camera Mode in Safari and pairs the device to your
              household.
            </p>
            {code}
          </li>
          <li>
            <h3>Allow the camera</h3>
            <p>
              Tap Allow when Safari asks. To start it again later with one tap,
              use Share, then Add to Home Screen.
            </p>
          </li>
          <li>
            <h3>Keep it awake</h3>
            <p>
              Apple pauses web apps in the background, so keep the device
              plugged in with the screen on. For an always-on camera, an Android
              phone or a computer works better.
            </p>
          </li>
        </Steps>
      )}
    </section>
  );
}
