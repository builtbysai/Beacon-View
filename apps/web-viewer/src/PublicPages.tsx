import { useEffect, useState } from 'react';

import { Brand, Icon } from './Icon';
import { PublicHeader } from './PublicHeader';
import './Trust.css';

export function PairLinkPage() {
  const code = new URLSearchParams(window.location.search)
    .get('code')
    ?.toUpperCase();
  const validCode = code?.match(/^[A-HJ-NP-Z2-9]{10}$/)?.[0];

  return (
    <main className="trust-shell">
      <section className="trust-page" aria-labelledby="pair-link-title">
        <a className="trust-brand" href="/" aria-label="Beacon View home">
          <Brand />
        </a>
        <p className="eyebrow">New camera</p>
        <h1 id="pair-link-title">
          {validCode
            ? 'Open this link on your camera phone.'
            : 'That setup link is no longer available.'}
        </h1>
        {validCode ? (
          <>
            <p className="trust-lead">
              Beacon opens automatically when it is installed. Otherwise, open
              the Beacon Android app and enter this one-time code, or use this
              browser as the camera.
            </p>
            <p
              className="pair-link-code"
              aria-label={`Pairing code ${validCode}`}
            >
              {validCode}
            </p>
            <p className="pair-link-note">
              Only use this link on a device you own or are authorized to set
              up. It expires in 10 minutes.
            </p>
            <a
              className="btn primary w-full"
              href={`/camera-mode/setup?code=${validCode}`}
            >
              Use this browser as camera
            </a>
          </>
        ) : (
          <p className="trust-lead">
            Ask the account owner to create a fresh setup link. Pairing links
            are short-lived for your household's security.
          </p>
        )}
        <a className="btn-secondary w-full" href="/">
          Return to Beacon
        </a>
      </section>
    </main>
  );
}

/** Google sign-in for the desktop app finishes here, in the person's own
 * browser (ADR 0083). The page hands the one-time, PKCE-bound code to the
 * app through its link and removes it from the address bar. Browsers only
 * let a page close tabs that a script opened, so it says plainly that this
 * tab can be closed instead of leaving the person on Google's page. */
export function DesktopAuthReturnPage() {
  const [appLink] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get('code');
    if (code && /^[A-Za-z0-9_-]{32,512}$/.test(code))
      return `beaconsecureview://auth/desktop?code=${encodeURIComponent(code)}`;
    if (params.get('status') === 'failed')
      return 'beaconsecureview://auth/desktop?status=failed';
    return null;
  });
  const [closeHint, setCloseHint] = useState(false);
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    if (appLink) window.location.href = appLink;
  }, [appLink]);
  const failed = appLink?.endsWith('status=failed') ?? false;

  return (
    <main className="trust-shell">
      <section className="trust-page" aria-labelledby="desktop-auth-title">
        <a className="trust-brand" href="/" aria-label="Beacon View home">
          <Brand />
        </a>
        <p className="eyebrow">Beacon for desktop</p>
        <h1 id="desktop-auth-title">
          {!appLink
            ? 'This sign-in link has already been used.'
            : failed
              ? 'Sign-in didn’t finish.'
              : 'You’re signing in to the Beacon app.'}
        </h1>
        <p className="trust-lead">
          {!appLink
            ? 'Start Google sign-in again from the Beacon app if you still need to sign in.'
            : failed
              ? 'Return to the Beacon app and try again.'
              : 'Beacon is opening and finishing your sign-in. If your browser asks, choose Open Beacon.'}{' '}
          You can close this tab.
        </p>
        {appLink && !failed && (
          <a className="btn-primary w-full" href={appLink}>
            Open Beacon
          </a>
        )}
        <button
          className="btn-secondary w-full"
          onClick={() => {
            window.close();
            // window.close() is ignored for tabs the browser opened itself.
            setCloseHint(true);
          }}
          type="button"
        >
          Close this tab
        </button>
        {closeHint && (
          <p className="pair-link-note" role="status">
            Your browser keeps this tab open. Close it with Ctrl+W (⌘W on a
            Mac).
          </p>
        )}
      </section>
    </main>
  );
}

export function PublicTrustPage({
  returnHref = '/',
  returnLabel = 'Return to Beacon',
}: {
  returnHref?: string;
  returnLabel?: string;
}) {
  const trustLinks = [
    { label: 'How it works', href: '#details' },
    { label: 'Questions', href: '#faq' },
  ];

  const trustAction = (
    <a href={returnHref} className="ph-back-action">
      &larr; {returnLabel}
    </a>
  );

  return (
    <div className="trust-v4">
      <PublicHeader
        links={trustLinks}
        action={trustAction}
        sticky={true}
        alignContainer="trust"
      />

      <main>
        <section className="hero wrap">
          <div className="hero-main">
            <div>
              <p className="eyebrow">Trust & privacy</p>
              <h1>Privacy is part of how Beacon works.</h1>
              <p className="lede">
                Beacon connects your devices for live viewing without building a
                cloud archive of your camera or microphone.
              </p>
            </div>
            <div className="commitments">
              <article className="commitment">
                <div className="icon">
                  <Icon name="camera" />
                </div>
                <div>
                  <h2>Live, not archived</h2>
                  <p>
                    Beacon does not store your live video or audio. Clips exist
                    only if you turn them on, and they go to your own Google
                    Drive.
                  </p>
                </div>
              </article>
              <article className="commitment">
                <div className="icon">
                  <Icon name="eye" />
                </div>
                <div>
                  <h2>Capture stays visible</h2>
                  <p>
                    The camera device indicates when camera or microphone
                    capture is active.
                  </p>
                </div>
              </article>
              <article className="commitment">
                <div className="icon">
                  <Icon name="lock" />
                </div>
                <div>
                  <h2>Authenticated access</h2>
                  <p>
                    Live media uses encrypted WebRTC and is available to
                    authenticated viewers.
                  </p>
                </div>
              </article>
            </div>
          </div>
          <div className="scrollcue">↓ &nbsp;See exactly what Beacon keeps</div>
        </section>

        <section className="section" id="details">
          <div className="wrap">
            <div className="section-head">
              <div className="section-label">Live media</div>
              <div>
                <h2 className="big">Your stream is for the session.</h2>
                <p className="section-intro">
                  Beacon is designed around direct live viewing rather than
                  cloud video storage.
                </p>
              </div>
            </div>
            <div className="factgrid">
              <article className="fact">
                <h3>Video & audio</h3>
                <p>
                  Live media is streamed for viewing and is not stored by
                  Beacon. Optional clips are encrypted and saved to your own
                  Google Drive, not to Beacon.
                </p>
              </article>
              <article className="fact">
                <h3>Connection</h3>
                <p>
                  Media streams use WebRTC encryption between participating
                  devices.
                </p>
              </article>
              <article className="fact">
                <h3>Awareness</h3>
                <p>
                  The camera interface shows when capture is active, so
                  recording hardware is not silently engaged.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section data-band">
          <div className="wrap">
            <div className="section-head">
              <div className="section-label">Data</div>
              <div>
                <h2 className="big">A short list, on purpose.</h2>
                <p className="section-intro">
                  Beacon needs some information to operate your account and
                  cameras. Live media is not part of that stored data, and clip
                  files stay in your Google Drive.
                </p>
              </div>
            </div>
            <div className="compare">
              <article>
                <h3>Beacon keeps</h3>
                <p>
                  Account settings, camera names, camera settings, and
                  motion-event metadata such as timestamps without images, for
                  the configured retention period. If you use clips, Beacon also
                  keeps a record of each clip (time and length) and the keys
                  that unlock it.
                </p>
              </article>
              <article>
                <h3>Beacon does not keep</h3>
                <p>
                  Video streams, the clip files themselves, or facial
                  identities. Clips are encrypted before they reach your Google
                  Drive, but Beacon’s server can unlock them to play them back
                  to you, so clips are not end-to-end encrypted.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="wrap">
            <div className="section-head">
              <div className="section-label">Questions</div>
              <div>
                <h2 className="big">The details should be easy to find.</h2>
              </div>
            </div>
            <div className="faq">
              <details>
                <summary>Does Beacon record my live video?</summary>
                <p>
                  Not unless you turn on clips. Live viewing is not stored. If
                  you record a clip, it is encrypted and saved to your own
                  Google Drive, and Beacon's server can unlock it to play it
                  back to you. Clips are not end-to-end encrypted.
                </p>
              </details>
              <details>
                <summary>Who can view a live camera?</summary>
                <p>
                  Beacon describes live media as available to authenticated
                  viewers through encrypted WebRTC connections.
                </p>
              </details>
              <details>
                <summary>What information does Beacon retain?</summary>
                <p>
                  Account and camera settings, camera names, and motion-event
                  metadata may be retained, along with a record of each clip and
                  the keys that unlock it. Live video, audio, and facial
                  identities are not retained; clip files and their thumbnails
                  live in your Google Drive.
                </p>
              </details>
              <details>
                <summary>Can I ask a privacy question?</summary>
                <p>
                  Yes. Use the contact path below for privacy or deletion
                  questions.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap contact-strip">
            <div>
              <h2>Still have a privacy question?</h2>
              <p>Contact Beacon about privacy or deletion.</p>
            </div>
            <a className="button" href="/contact">
              Contact Beacon
            </a>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot">
          <span>
            Beacon is a private alpha. Not for emergency or life-safety
            monitoring.
          </span>
          <div className="footlinks">
            <a href="/contact">Contact</a>
            <a href={returnHref}>{returnLabel}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
