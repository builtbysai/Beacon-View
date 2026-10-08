import { Icon } from './Icon';
import './AddCameraPage.css';

type AddCameraPageProps = {
  onBack: () => void;
  onPairAndroid: () => void;
  onSetUpComputer: () => void;
  onUseBrowser: () => void;
};

export function AddCameraPage({
  onBack,
  onPairAndroid,
  onSetUpComputer,
  onUseBrowser,
}: AddCameraPageProps) {
  return (
    <div className="add-device-page">
      <button className="add-device-back" onClick={onBack}>
        &larr; Back to Home
      </button>

      <div className="add-device-intro">
        <h1>Add a device</h1>
        <p>
          Choose how this device will join Beacon. Start with a dedicated
          Android device, or turn the device you're using now into a temporary
          camera.
        </p>
      </div>

      <div className="add-device-grid">
        <article className="add-device-choice">
          <span className="add-device-tag">RECOMMENDED</span>
          <div className="add-device-ico">
            <Icon name="phone" />
          </div>
          <h2>Pair another device</h2>
          <p>
            Connect an Android phone or tablet running Beacon. Designed for
            ongoing monitoring.
          </p>
          <div className="add-device-meta">
            More device types can be added here as Beacon expands.
          </div>
          <button className="btn primary" onClick={onPairAndroid}>
            Pair a device &rarr;
          </button>
        </article>

        <article className="add-device-choice">
          <div className="add-device-ico">
            <Icon name="download" />
          </div>
          <h2>Set up another computer</h2>
          <p>
            Turn a spare Windows, Mac, or Linux computer into a camera that runs
            in the background and wakes when you view it.
          </p>
          <div className="add-device-meta">
            One download that sets itself up.
          </div>
          <button className="btn secondary" onClick={onSetUpComputer}>
            Set up a computer &rarr;
          </button>
        </article>

        <article className="add-device-choice">
          <div className="add-device-ico">
            <Icon name="browser" />
          </div>
          <h2>Use this device</h2>
          <p>
            Use a camera available on the device you're using right now. Best
            for temporary monitoring.
          </p>
          <div className="add-device-meta">No separate device required.</div>
          <button className="btn secondary" onClick={onUseBrowser}>
            Use this device &rarr;
          </button>
        </article>
      </div>

      <div className="add-device-note">
        <Icon name="alert" /> Only connect or use devices you own or are
        authorized to access.
      </div>
    </div>
  );
}
