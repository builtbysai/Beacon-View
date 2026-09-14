import { Icon } from './Icon';

type AddCameraPageProps = {
  onPairAndroid: () => void;
  onUseBrowser: () => void;
};

export function AddCameraPage({
  onPairAndroid,
  onUseBrowser,
}: AddCameraPageProps) {
  return (
    <section className="card wide workspace-medium">
      <h3>Choose a device</h3>
      <div className="setup-options">
        <article>
          <span className="setup-icon">
            <Icon name="phone" />
          </span>
          <h4>Android phone or tablet</h4>
          <p>Best for always-on use.</p>
          <button onClick={onPairAndroid}>
            Pair Android
            <Icon name="arrow" />
          </button>
        </article>
        <article>
          <span className="setup-icon">
            <Icon name="browser" />
          </span>
          <h4>This browser</h4>
          <p>Best for temporary use.</p>
          <button className="secondary" onClick={onUseBrowser}>
            Use this browser
          </button>
        </article>
      </div>
      <p className="notice">
        Pair only a device you own or are authorized to use.
      </p>
    </section>
  );
}
