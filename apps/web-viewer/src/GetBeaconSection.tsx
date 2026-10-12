import { AppDownloads } from './AppDownloads';

/** "Get Beacon" on the landing page (ADR 0083, ADR 0118). The downloads come from the self-hosted manifest, so
 * only builds that were actually published are offered. */
export function GetBeaconSection({ onOpenWeb }: { onOpenWeb: () => void }) {
  return (
    <section className="section get-beacon" id="download">
      <div className="wrap">
        <div className="section-head">
          <p>Get Beacon</p>
          <h2>On every device you have.</h2>
          <p className="sub">
            Use the same account everywhere. Computers and phones can watch your
            cameras or become one.
          </p>
        </div>
        <AppDownloads onOpenWeb={onOpenWeb} variant="landing" />
      </div>
    </section>
  );
}
