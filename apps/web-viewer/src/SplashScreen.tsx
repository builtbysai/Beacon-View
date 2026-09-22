import { Icon } from './Icon';
import './SplashScreen.css';
import { PublicHeader } from './PublicHeader';

export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  const listening = false;
  const talking = false;
  const recording = false;
  const demoCamera: 'living' | 'entry' = 'living';
  const splashLinks = [
    { label: 'How it works', href: '#how' },
    { label: 'Privacy', href: '#privacy' },
    { label: 'Trust', href: '/trust' },
  ];

  const splashAction = (
    <a
      className="btn primary"
      href="/account"
      onClick={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      Get started
    </a>
  );

  return (
    <>
      <PublicHeader
        links={splashLinks}
        action={splashAction}
        sticky
        alignContainer="splash"
      />
      <div className="splash-v4">
        <main>
          <section className="hero wrap">
            <div className="hero-copy">
              <p className="eyebrow">Your space, within reach</p>
              <h1>Turn a spare device into your camera.</h1>
              <p className="lede">
                Use a phone, tablet, or computer as a live camera and view it
                securely from another device. No dedicated hardware required.
              </p>
              <div className="ctas">
                <button
                  className="btn primary"
                  onClick={onContinue}
                  type="button"
                >
                  Get started <span aria-hidden="true">→</span>
                </button>
                <a className="btn secondary" href="#how">
                  See how it works
                </a>
              </div>
              <div className="micro" aria-label="Beacon highlights">
                <span>
                  <Icon name="check" />
                  Live viewing
                </span>
                <span>
                  <Icon name="check" />
                  Encrypted connection
                </span>
                <span>
                  <Icon name="check" />
                  Optional cloud recording
                </span>
              </div>
            </div>

            <div className="demo" aria-label="Beacon live viewer preview">
              <div className="window splash-demo-window">
                <div className="windowbar">
                  <div className="dots" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <div className="demo-window-title">
                    <Icon name="lock" />
                    <span>Beacon Live</span>
                  </div>
                  <span className="live">LIVE</span>
                </div>
                <div className="feed">
                  <div
                    className={`demo-scene demo-scene-${demoCamera}`}
                    aria-hidden="true"
                  >
                    <div className="scene-wall">
                      <span className="scene-frame scene-frame-a"></span>
                      <span className="scene-frame scene-frame-b"></span>
                    </div>
                    <div className="scene-window">
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <div className="scene-sofa">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <div className="scene-table">
                      <i></i>
                    </div>
                    <div className="scene-plant">
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <div className="scene-lamp">
                      <i></i>
                    </div>
                    <div className="scene-floor"></div>
                    <div className="scene-vignette"></div>
                  </div>
                  <div className="feed-topline" aria-hidden="true">
                    <span className="feed-quality">HD · 1080p</span>
                    <span className="feed-secure">
                      <Icon name="lock" />
                      Encrypted
                    </span>
                  </div>
                  <div className="feed-identity">
                    <span className="feed-camera-icon">
                      <Icon name="camera" />
                    </span>
                    <span>
                      <strong>
                        {demoCamera === 'living'
                          ? 'Living room'
                          : 'Front entry'}
                      </strong>
                      <small>
                        {demoCamera === 'living'
                          ? 'Spare phone · Rear camera'
                          : 'Tablet · Wide camera'}
                      </small>
                    </span>
                  </div>
                  <div className="feed-time" aria-hidden="true">
                    <span className="feed-pulse"></span>Live now
                  </div>
                </div>
                <div className="controls demo-controls">
                  <div className="device">
                    <span className="avatar">
                      <Icon
                        name={demoCamera === 'living' ? 'phone' : 'browser'}
                      />
                    </span>
                    <span className="demo-device-copy">
                      <strong>
                        {demoCamera === 'living'
                          ? 'Spare phone'
                          : 'Entry tablet'}
                      </strong>
                      <small>Online · Wi-Fi</small>
                    </span>
                  </div>
                  <div
                    className="controlset"
                    aria-label="Example live view controls"
                  >
                    <span className="control" title="Listen">
                      <Icon name="speaker" />
                    </span>
                    <span className="control" title="Talk">
                      <Icon name="mic" />
                    </span>
                    <span
                      className="control demo-record-control"
                      title="Record"
                    >
                      <Icon name="record" />
                    </span>
                    <span className="control" title="Full screen">
                      <Icon name="maximize" />
                    </span>
                  </div>
                </div>
                <div className="demo-statusbar" aria-hidden="true">
                  <span>
                    <i className="status-dot"></i>Direct connection
                  </span>
                  <span>
                    {recording
                      ? 'Recording'
                      : listening
                        ? 'Listening'
                        : talking
                          ? 'Talking'
                          : '1 viewer'}
                  </span>
                  <span>
                    {recording
                      ? 'REC'
                      : demoCamera === 'living'
                        ? '00:18'
                        : '00:07'}
                  </span>
                </div>
              </div>
              <div
                className="demo-float-card demo-float-secure"
                aria-hidden="true"
              >
                <span>
                  <Icon name="lock" />
                </span>
                <div>
                  <strong>Private connection</strong>
                  <small>Media is encrypted in transit</small>
                </div>
              </div>
              <div
                className="demo-float-card demo-float-device"
                aria-hidden="true"
              >
                <span>
                  <Icon name="phone" />
                </span>
                <div>
                  <strong>Camera active</strong>
                  <small>Visible on the source device</small>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="how">
            <div className="wrap">
              <div className="section-head">
                <p>How it works</p>
                <h2>Two devices. One private view.</h2>
                <p className="sub">
                  Beacon turns hardware you already own into a simple live
                  monitoring setup.
                </p>
              </div>
              <div className="steps">
                <article className="step">
                  <span className="num">01</span>
                  <h3>Choose a camera</h3>
                  <p>
                    Open Beacon on the spare phone, tablet, or computer you want
                    to use for capture.
                  </p>
                </article>
                <article className="step">
                  <span className="num">02</span>
                  <h3>Connect securely</h3>
                  <p>
                    Beacon establishes an authenticated, encrypted WebRTC
                    connection between your devices.
                  </p>
                </article>
                <article className="step">
                  <span className="num">03</span>
                  <h3>Watch live</h3>
                  <p>
                    View the camera from your other device while capture remains
                    clearly visible at the source.
                  </p>
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
                  Beacon keeps live viewing explicit and gives you control over
                  optional recordings and retained event data.
                </p>
                <a className="trustlink" href="/trust">
                  Read how Beacon handles privacy →
                </a>
              </div>
              <div className="principles">
                <article className="principle">
                  <div className="picon">
                    <Icon name="eye" />
                  </div>
                  <div>
                    <h3>Live by default</h3>
                    <p>
                      Live viewing does not automatically create a recording.
                    </p>
                  </div>
                </article>
                <article className="principle">
                  <div className="picon">
                    <Icon name="record" />
                  </div>
                  <div>
                    <h3>Capture stays visible</h3>
                    <p>
                      The camera device indicates when camera or microphone
                      capture is active.
                    </p>
                  </div>
                </article>
                <article className="principle">
                  <div className="picon">
                    <Icon name="lock" />
                  </div>
                  <div>
                    <h3>Private access</h3>
                    <p>
                      Live media uses encrypted WebRTC and authenticated access.
                    </p>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section className="final wrap">
            <h2>Put the device in your drawer back to work.</h2>
            <p>Turn it into a Beacon camera in a few steps.</p>
            <button className="btn primary" onClick={onContinue} type="button">
              Get started →
            </button>
          </section>
        </main>
        <footer>
          <div className="wrap foot">
            <span>Beacon · Private alpha</span>
            <div className="footlinks">
              <a href="/trust">Trust & privacy</a>
              <a href="/contact">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
