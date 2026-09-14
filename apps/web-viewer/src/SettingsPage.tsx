import { AccessHistory } from './AccessHistory';
import { Avatar } from './Avatar';
import { BrowserSessions } from './BrowserSessions';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import type { User } from './domain';

type SettingsPageProps = {
  user: User;
  onLogout: () => void;
  onDeleteAccount: () => void;
  onCurrentSessionRevoked: (message?: string) => void;
};

export function SettingsPage({
  user,
  onLogout,
  onDeleteAccount,
  onCurrentSessionRevoked,
}: SettingsPageProps) {
  return (
    <div className="settings-layout wide">
      <section
        className="settings-section"
        aria-labelledby="account-section-title"
      >
        <h3 id="account-section-title">Account</h3>
        <div className="settings-row settings-row-identity">
          <div className="settings-identity">
            <Avatar email={user.email} avatarUrl={user.avatarUrl} size="lg" />
            <div>
              <strong>{user.email}</strong>
              <p>This session</p>
            </div>
          </div>
          <button className="secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="security-section-title"
      >
        <h3 id="security-section-title">Security</h3>
        <BrowserSessions onCurrentRevoked={onCurrentSessionRevoked} />
        <AccessHistory currentEmail={user.email} />
      </section>

      <section
        className="settings-section"
        aria-labelledby="camera-section-title"
      >
        <h3 id="camera-section-title">Camera &amp; motion</h3>
        <MotionRetentionSettings />
      </section>

      <section
        className="settings-section"
        aria-labelledby="privacy-section-title"
      >
        <h3 id="privacy-section-title">Privacy</h3>
        <div className="settings-row">
          <div>
            <strong>Trust &amp; privacy</strong>
            <p>
              Viewing, listening, and talking are separate choices. See how
              Beacon handles capture and account data.
            </p>
          </div>
          <a className="secondary button-link" href="/trust">
            Read more
          </a>
        </div>
      </section>

      <section
        className="settings-section settings-danger"
        aria-labelledby="danger-section-title"
      >
        <h3 id="danger-section-title">Danger zone</h3>
        <div className="settings-row">
          <div>
            <strong>Delete this account</strong>
            <p>
              Permanently deletes your Beacon household, paired devices,
              settings, and motion history. You&rsquo;ll be asked to confirm
              before deletion.
            </p>
          </div>
          <button className="danger" onClick={onDeleteAccount}>
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}
