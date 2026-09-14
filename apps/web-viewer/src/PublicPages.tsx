import { Brand } from './Icon';

export function PairLinkPage() {
  const code = new URLSearchParams(window.location.search)
    .get('code')
    ?.toUpperCase();
  const validCode = code?.match(/^[A-HJ-NP-Z2-9]{10}$/)?.[0];

  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="pair-link-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
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
              the Beacon Android app and enter this one-time code.
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
          </>
        ) : (
          <p className="trust-lead">
            Ask the account owner to create a fresh setup link. Pairing links
            are short-lived for your household’s security.
          </p>
        )}
        <a className="secondary button-link" href="/">
          Return to Beacon
        </a>
      </section>
    </main>
  );
}

export function MobileAuthReturnPage() {
  const status = new URLSearchParams(window.location.hash.slice(1)).get(
    'status',
  );
  const message =
    status === 'linkRequired'
      ? 'This email already has a Beacon password account. Use that account in the app.'
      : status === 'failed'
        ? 'Google sign-in could not be completed. Return to Beacon and try again.'
        : 'Return to the Beacon Android app to finish signing in.';
  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="mobile-auth-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Beacon for Android</p>
        <h1 id="mobile-auth-title">Finish in Beacon.</h1>
        <p className="trust-lead">{message}</p>
        <a className="secondary button-link" href="/">
          Return to Beacon
        </a>
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
  return (
    <main className="shell trust-shell">
      <section className="trust-page" aria-labelledby="trust-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Trust and privacy</p>
        <h1 id="trust-title">Your camera stays under your control.</h1>
        <dl className="trust-facts">
          <div>
            <dt>Live only</dt>
            <dd>Video and audio are not stored.</dd>
          </div>
          <div>
            <dt>Visible capture</dt>
            <dd>The camera device shows when capture is active.</dd>
          </div>
          <div>
            <dt>Separate controls</dt>
            <dd>Viewing, listening, and talking each need their own action.</dd>
          </div>
        </dl>

        <div className="trust-keep">
          <div>
            <h2>What Beacon keeps</h2>
            <p>
              Account and camera settings, camera names, and motion-event
              metadata for your chosen retention period.
            </p>
          </div>
          <div>
            <h2>What Beacon never keeps</h2>
            <p>Video, audio, thumbnails, or facial identities.</p>
          </div>
        </div>

        <a className="secondary button-link trust-return" href={returnHref}>
          {returnLabel}
        </a>

        <p className="trust-alpha-note">
          Beacon is a private alpha. Formal terms are still coming. For privacy
          or deletion questions, use the <a href="/contact">contact form</a>. Do
          not rely on Beacon for emergency response or life-safety monitoring.
        </p>
      </section>
    </main>
  );
}
