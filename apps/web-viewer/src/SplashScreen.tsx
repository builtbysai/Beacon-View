import { Brand, Icon } from './Icon';

export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="splash-screen">
      <div className="splash-content">
        <Brand className="splash-brand" />
        <p className="eyebrow">Your space, within reach</p>
        <h1>
          Turn any spare device into a camera,
          <br />
          <em>watch it live from anywhere.</em>
        </h1>
        <p className="splash-lead">
          Beacon connects a spare Android phone to any modern browser over a
          private, encrypted link. Capture stays visible on the device. Nothing
          is ever recorded.
        </p>

        <div className="trust-flow splash-flow" aria-hidden="true">
          <span className="trust-flow-step">
            <Icon name="phone" />
            <span>Your device</span>
          </span>
          <span className="trust-flow-link" />
          <span className="trust-flow-step">
            <Icon name="lock" />
            <span>Encrypted link</span>
          </span>
          <span className="trust-flow-link" />
          <span className="trust-flow-step">
            <Icon name="browser" />
            <span>Your viewer</span>
          </span>
        </div>

        <div className="splash-promises">
          <span>
            <Icon name="shield" />
            Visible capture
          </span>
          <span>
            <Icon name="lock" />
            Private access
          </span>
          <span>
            <Icon name="eyeOff" />
            No cloud recordings
          </span>
        </div>

        <button className="splash-cta" onClick={onContinue} type="button">
          Get started
          <Icon name="arrow" />
        </button>

        <a className="splash-trust-link" href="/trust">
          How Beacon handles your privacy
        </a>
      </div>
    </main>
  );
}
