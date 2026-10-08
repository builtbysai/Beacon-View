import { useEffect, useState } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { downloadBlob } from './browser-download';
import {
  CAMERA_USE_CASES,
  type CameraUseCase,
  cameraUseCase,
} from './camera-use-case';
import {
  type CameraSetup,
  cameraSetupFile,
  cameraSetupLink,
  downloadUrl,
  type DownloadsManifest,
  loadDownloads,
  preconfiguredInstallerName,
  primaryDownload,
} from './downloads';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import { rememberPendingUseCase } from './pending-use-case';
import './ComputerCameraSetupDialog.css';

interface PairingCode {
  code: string;
  expiresAt: string;
}

function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Sets up another computer as a camera in one step (ADR 0083). The owner
 * picks what the camera is for; Beacon creates the normal one-time pairing
 * code and offers it as a pre-configured Windows installer, a setup file or
 * link for an installed app, or a plain browser link.
 */
export function ComputerCameraSetupDialog({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const [useCase, setUseCase] = useState<CameraUseCase>('security');
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void loadDownloads().then(setManifest);
  }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const info = cameraUseCase(useCase);
  const setup: CameraSetup | null = pairing
    ? { code: pairing.code, microphone: info.microphone, power: info.power }
    : null;
  const expired = pairing ? Date.parse(pairing.expiresAt) <= now : false;
  const windows = primaryDownload(manifest, 'windows');
  const otherDownloads = (['macos', 'linux'] as const)
    .map((platform) => ({
      file: primaryDownload(manifest, platform),
      platform,
    }))
    .filter((entry) => entry.file !== null);
  const browserLink = setup
    ? `${window.location.origin}/camera-mode/setup?${new URLSearchParams({
        autostart: '1',
        code: setup.code,
        mic: setup.microphone ? '1' : '0',
        power: setup.power,
      }).toString()}`
    : '';

  async function createSetup() {
    setBusy(true);
    setError('');
    try {
      const result = await request<PairingCode>('/api/pairing-codes', {
        body: '{}',
        method: 'POST',
      });
      rememberPendingUseCase(useCase, result.expiresAt);
      setNow(Date.now());
      setPairing(result);
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'The camera setup couldn’t be created. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog labelledBy="computer-setup-title" onDismiss={onDismiss}>
      <section
        className="computer-setup"
        aria-labelledby="computer-setup-title"
      >
        <div className="computer-setup-head">
          <p className="computer-setup-eyebrow">Computer camera</p>
          <h2 id="computer-setup-title">
            {pairing
              ? 'Set up the camera computer'
              : 'Set up a computer as a camera'}
          </h2>
          <p>
            {pairing
              ? 'Use one of these on the computer that will be the camera. Its camera use stays visible there.'
              : 'Choose what the camera is for. You can change it later.'}
          </p>
        </div>

        {error && (
          <p className="computer-setup-error" role="alert">
            {error}
          </p>
        )}

        {!pairing ? (
          <>
            <fieldset className="computer-setup-uses">
              <legend className="visually-hidden">What it’s for</legend>
              {CAMERA_USE_CASES.map((option) => (
                <label
                  className={`computer-setup-use${option.id === useCase ? ' is-selected' : ''}`}
                  key={option.id}
                >
                  <input
                    checked={option.id === useCase}
                    name="computerUseCase"
                    onChange={() => setUseCase(option.id)}
                    type="radio"
                  />
                  <span>
                    <b>{option.label}</b>
                    <span>{option.computer}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="computer-setup-actions">
              <button
                className="btn secondary"
                onClick={onDismiss}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void createSetup()}
                type="button"
              >
                {busy ? 'Creating…' : 'Create setup'}
              </button>
            </div>
          </>
        ) : expired || !setup ? (
          <div className="computer-setup-expired" role="status">
            <p>This setup expired. Setups last 10 minutes for your security.</p>
            <button
              className="btn primary"
              onClick={() => void createSetup()}
              type="button"
            >
              Create a new setup
            </button>
          </div>
        ) : (
          <>
            <p
              className="computer-setup-code"
              aria-label={`Pairing code ${setup.code}`}
            >
              {setup.code}
              <span>Expires in {remaining(pairing.expiresAt, now)}</span>
            </p>

            <div className="computer-setup-option">
              <h3>New computer</h3>
              {windows ? (
                <>
                  <a
                    className="btn primary"
                    download={preconfiguredInstallerName(windows, setup)}
                    href={downloadUrl(windows)}
                  >
                    <Icon name="download" /> Download for Windows
                  </a>
                  <p className="local-hint">
                    It sets itself up: run it on the camera computer within 10
                    minutes, and Beacon installs, joins your household as{' '}
                    {`“${info.label}”`}, and starts with the computer.
                  </p>
                </>
              ) : (
                <p className="local-hint">
                  The Windows app isn’t published on this server yet.
                </p>
              )}
              {otherDownloads.length > 0 && (
                <p className="local-hint">
                  On{' '}
                  {otherDownloads.map(({ file, platform }, index) => (
                    <span key={platform}>
                      {index > 0 && ' or '}
                      <a href={downloadUrl(file!)}>
                        {platform === 'macos' ? 'a Mac' : 'Linux'}
                      </a>
                    </span>
                  ))}
                  , install Beacon, then open the setup file below.
                </p>
              )}
            </div>

            <div className="computer-setup-option">
              <h3>Beacon already installed</h3>
              <div className="computer-setup-row">
                <a className="btn secondary" href={cameraSetupLink(setup)}>
                  Open in Beacon
                </a>
                <button
                  className="btn secondary"
                  onClick={() =>
                    downloadBlob(
                      cameraSetupFile(setup),
                      'Beacon camera setup.beaconcamera',
                    )
                  }
                  type="button"
                >
                  Download setup file
                </button>
              </div>
              <p className="local-hint">
                “Open in Beacon” works on this computer. Send the setup file to
                another one — it holds only this one-time code.
              </p>
            </div>

            <div className="computer-setup-option">
              <h3>No install</h3>
              <div className="computer-setup-row">
                <a className="btn secondary" href={browserLink}>
                  Use this browser
                </a>
                <button
                  className="btn secondary"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(browserLink)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError(
                          'Couldn’t copy the link. Select it and copy it manually.',
                        ),
                      );
                  }}
                  type="button"
                >
                  {copied ? 'Link copied' : 'Copy browser link'}
                </button>
              </div>
              <p className="local-hint">
                A browser tab works too, but it has to stay open.
              </p>
            </div>

            <div className="computer-setup-actions">
              <button
                className="btn secondary"
                onClick={onDismiss}
                type="button"
              >
                Done
              </button>
            </div>
          </>
        )}
      </section>
    </ModalDialog>
  );
}
