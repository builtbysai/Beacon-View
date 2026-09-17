import { Icon } from './Icon';
import './SplashScreen.css';
import { PublicHeader } from './PublicHeader';

export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  const splashLinks = [
    { label: 'How it works', href: '#how' },
    { label: 'Privacy', href: '#privacy' },
    { label: 'Trust', href: '/trust' }
  ];

  const splashAction = (
    <a className="btn primary" href="/account" onClick={(e) => { e.preventDefault(); onContinue(); }}>Get started</a>
  );

  return (
    <>
      <PublicHeader links={splashLinks} action={splashAction} sticky={true} alignContainer="splash" />
      <div className="splash-v4">
        <main>
          <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">Your space, within reach</p>
            <h1>Turn a spare device into your camera.</h1>
            <p className="lede">
              Use a phone, tablet, or computer as a live camera and view it securely from another device. No dedicated hardware required.
            </p>
            <div className="ctas">
              <button className="btn primary" onClick={onContinue} type="button">Get started <span>→</span></button>
              <a className="btn secondary" href="#how">See how it works</a>
            </div>
            <div className="micro">
              <span><Icon name="check" />Live viewing</span>
              <span><Icon name="check" />Encrypted connection</span>
              <span><Icon name="check" />No cloud recordings</span>
            </div>
          </div>

          <div className="demo" aria-label="Beacon live viewer preview">
            <div className="window">
              <div className="windowbar">
                <div className="dots"><i></i><i></i><i></i></div>
                <span className="live">LIVE</span>
              </div>
              <div className="feed">
                <div className="room"></div>
                <div className="camera-mark">
                  <svg viewBox="0 0 48 48" fill="none">
                    <rect x="7" y="12" width="25" height="24" rx="6" stroke="currentColor" strokeWidth="2" />
                    <path d="m32 19 9-5v20l-9-5" stroke="currentColor" strokeWidth="2" />
                    <circle cx="19.5" cy="24" r="5" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <p>Living room camera</p>
                </div>
              </div>
              <div className="controls">
                <div className="device">
                  <span className="avatar" style={{ fontSize: '1rem' }}><Icon name="user" /></span>
                  <span>Spare phone</span>
                </div>
                <div className="controlset">
                  <span className="control"><Icon name="record" /></span>
                  <span className="control"><Icon name="mic" /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head">
              <p>How it works</p>
              <h2>Two devices. One private view.</h2>
              <p className="sub">Beacon turns hardware you already own into a simple live monitoring setup.</p>
            </div>
            <div className="steps">
              <article className="step">
                <span className="num">01</span>
                <h3>Choose a camera</h3>
                <p>Open Beacon on the spare phone, tablet, or computer you want to use for capture.</p>
              </article>
              <article className="step">
                <span className="num">02</span>
                <h3>Connect securely</h3>
                <p>Beacon establishes an authenticated, encrypted WebRTC connection between your devices.</p>
              </article>
              <article className="step">
                <span className="num">03</span>
                <h3>Watch live</h3>
                <p>View the camera from your other device while capture remains clearly visible at the source.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section privacy" id="privacy">
          <div className="wrap privacy-grid">
            <div>
              <p className="eyebrow">Privacy by design</p>
              <h2>A camera should never be ambiguous.</h2>
              <p className="privacy-copy">
                Beacon is built around live viewing rather than creating a cloud archive of what happens in your space.
              </p>
              <a className="trustlink" href="/trust">Read how Beacon handles privacy →</a>
            </div>
            <div className="principles">
              <article className="principle">
                <div className="picon"><Icon name="eye" /></div>
                <div>
                  <h3>Live, not archived</h3>
                  <p>Beacon does not store your live video or audio.</p>
                </div>
              </article>
              <article className="principle">
                <div className="picon"><Icon name="record" /></div>
                <div>
                  <h3>Capture stays visible</h3>
                  <p>The camera device indicates when camera or microphone capture is active.</p>
                </div>
              </article>
              <article className="principle">
                <div className="picon"><Icon name="lock" /></div>
                <div>
                  <h3>Private access</h3>
                  <p>Live media uses encrypted WebRTC and authenticated access.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="final wrap">
          <h2>Put the device in your drawer back to work.</h2>
          <p>Turn it into a Beacon camera in a few steps.</p>
          <button className="btn primary" onClick={onContinue} type="button">Get started →</button>
        </section>
      </main>

      <footer>
        <div className="wrap foot">
          <span>Beacon · Private alpha</span>
          <div className="footlinks">
            <a href="/trust">Trust & privacy</a>
            <a href="/contact">Contact</a>
            <a href="/account">Sign in</a>
          </div>
        </div>
      </footer>
    </div>
    </>
  );
}
