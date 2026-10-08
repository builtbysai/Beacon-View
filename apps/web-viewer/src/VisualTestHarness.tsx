import { useState } from 'react';
import { Icon } from './Icon';
import './VisualTestHarness.css';

/**
 * Development-only visual harness for states that normally require an online
 * WebRTC camera. main.tsx gates this behind import.meta.env.DEV, so this can
 * never replace production camera/signaling behavior.
 *
 * Open: /?beaconVisual=live
 */
export function VisualTestHarness() {
  const [camera, setCamera] = useState<
    'Front Door' | 'Living Room' | 'Backyard'
  >('Front Door');
  const [privacy, setPrivacy] = useState(false);
  const [listening, setListening] = useState(false);
  const [talking, setTalking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [settings, setSettings] = useState(false);
  const [state, setState] = useState<
    'live' | 'connecting' | 'reconnecting' | 'offline'
  >('live');

  const live = state === 'live' && !privacy;
  const status = privacy
    ? 'PRIVACY ON'
    : state === 'live'
      ? 'LIVE'
      : state.toUpperCase();

  return (
    <main
      className="live-shell beacon-visual-harness"
      aria-label="Beacon live viewer visual test"
    >
      <div className="video-frame">
        <div className="visual-camera-scene" aria-hidden="true">
          <div className="visual-camera-glow" />
          <div className="visual-camera-room">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="video-top-scrim">
          <button aria-label="Back" className="video-back" type="button">
            <Icon name="chevronLeft" />
          </button>
          <div className="video-identity">
            <span className={`video-live-badge${live ? ' is-live' : ''}`}>
              {status}
            </span>
            <h1 id="live-title">{camera}</h1>
            <span>Test camera · Visual preview</span>
          </div>
          <button
            aria-label="Camera settings"
            className="video-settings-button"
            onClick={() => setSettings(true)}
            type="button"
          >
            <Icon name="settings" />
          </button>
        </div>
        {!live && (
          <div className="video-overlay">
            <strong>
              {privacy
                ? 'Camera paused'
                : state === 'offline'
                  ? 'Camera offline'
                  : state === 'reconnecting'
                    ? 'Reconnecting camera'
                    : 'Connecting camera'}
            </strong>
            <span>
              {privacy
                ? 'Privacy mode is on for this test camera.'
                : state === 'offline'
                  ? 'The test camera is unavailable.'
                  : 'Establishing a secure live connection.'}
            </span>
          </div>
        )}
        <div
          aria-label="Live view controls"
          className="video-controls is-visible"
        >
          <button
            aria-pressed={listening}
            className="video-control"
            data-tooltip="Listen"
            onClick={() => setListening((v) => !v)}
            type="button"
          >
            <Icon name={listening ? 'speaker' : 'speakerOff'} />
            <span className="visually-hidden">Listen</span>
          </button>
          <button
            aria-pressed={talking}
            className="video-control"
            data-tooltip="Talk"
            onClick={() => setTalking((v) => !v)}
            type="button"
          >
            <Icon name={talking ? 'micOff' : 'mic'} />
            <span className="visually-hidden">Talk</span>
          </button>
          <button
            className="video-control"
            data-tooltip="Switch camera"
            onClick={() =>
              setCamera((current) =>
                current === 'Front Door'
                  ? 'Living Room'
                  : current === 'Living Room'
                    ? 'Backyard'
                    : 'Front Door',
              )
            }
            type="button"
          >
            <Icon name="flip" />
            <span className="visually-hidden">Switch camera</span>
          </button>
          <button
            aria-pressed={privacy}
            className={`video-control${privacy ? ' is-active' : ''}`}
            data-tooltip="Privacy"
            onClick={() => setPrivacy((v) => !v)}
            type="button"
          >
            <Icon name="lock" />
            <span className="visually-hidden">Privacy</span>
          </button>
          <button
            aria-pressed={recording}
            className={`video-control${recording ? ' is-active' : ''}`}
            data-tooltip="Record"
            disabled={!live}
            onClick={() => setRecording((v) => !v)}
            type="button"
          >
            <Icon name="record" />
            <span className="visually-hidden">Record</span>
          </button>
          <button
            className="video-control"
            data-tooltip="Full screen"
            type="button"
          >
            <Icon name="maximize" />
            <span className="visually-hidden">Full screen</span>
          </button>
        </div>
        <button
          className="visual-state-button"
          type="button"
          onClick={() =>
            setState((current) =>
              current === 'live'
                ? 'connecting'
                : current === 'connecting'
                  ? 'reconnecting'
                  : current === 'reconnecting'
                    ? 'offline'
                    : 'live',
            )
          }
        >
          Test state: {state}
        </button>
        {settings && (
          <div
            className="visual-settings-backdrop"
            onMouseDown={() => setSettings(false)}
          >
            <aside
              className="visual-settings-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`${camera} settings`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <small>TEST CAMERA</small>
                  <h2>{camera}</h2>
                </div>
                <button
                  aria-label="Close settings"
                  onClick={() => setSettings(false)}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </header>
              <div className="visual-settings-body">
                <section className="visual-health">
                  <div>
                    <span>Connection</span>
                    <strong>{live ? 'Online' : status}</strong>
                  </div>
                  <div>
                    <span>Last seen</span>
                    <strong>Now</strong>
                  </div>
                  <div>
                    <span>Viewers</span>
                    <strong>1</strong>
                  </div>
                </section>
                <section className="visual-setting-row">
                  <div>
                    <strong>Privacy</strong>
                    <p>Pause capture on this camera.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={privacy}
                    className={`camera-settings-switch ${privacy ? 'is-on' : ''}`}
                    onClick={() => setPrivacy((v) => !v)}
                  >
                    <span />
                  </button>
                </section>
                <section className="visual-setting-row">
                  <div>
                    <strong>Motion detection</strong>
                    <p>Notify when movement is detected.</p>
                  </div>
                  <span>Medium</span>
                </section>
                <section className="visual-setting-row">
                  <div>
                    <strong>Device information</strong>
                    <p>Android phone · Test environment</p>
                  </div>
                  <Icon name="chevronRight" />
                </section>
              </div>
              <footer>
                <span>Visual test only · no backend calls</span>
                <button
                  className="secondary"
                  onClick={() => setSettings(false)}
                  type="button"
                >
                  Done
                </button>
              </footer>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
