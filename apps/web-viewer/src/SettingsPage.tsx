import { useState } from 'react';

import { AccessHistory } from './AccessHistory';
import { Avatar } from './Avatar';
import { BrowserSessions } from './BrowserSessions';
import { EmailVerification } from './EmailVerification';
import { GoogleDriveSettings } from './GoogleDriveSettings';
import { HouseholdSharingSettings } from './HouseholdSharingSettings';
import { HouseholdSwitcher } from './HouseholdSwitcher';
import { LinkGoogleAccount } from './LinkGoogleAccount';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import { NotificationSettings } from './NotificationSettings';
import type { Camera, HouseholdSession, User } from './domain';

type SettingsPageProps = {
  user: User;
  household: HouseholdSession;
  cameras: Camera[];
  onLogout: () => void;
  onDeleteAccount: () => void;
  onCurrentSessionRevoked: (message?: string) => void;
};

type SettingsSection =
  | 'household'
  | 'alerts'
  | 'access'
  | 'camera'
  | 'storage'
  | 'security'
  | 'account'
  | 'privacy';

const labels: Record<SettingsSection, string> = {
  household: 'Household',
  alerts: 'Alerts',
  access: 'People & access',
  camera: 'Camera & motion',
  storage: 'Cloud storage',
  security: 'Security',
  account: 'Account',
  privacy: 'Privacy',
};

export function SettingsPage({
  user,
  household,
  cameras,
  onLogout,
  onDeleteAccount,
  onCurrentSessionRevoked,
}: SettingsPageProps) {
  const manager = household.role === 'owner' || household.role === 'admin';
  const sections: SettingsSection[] = [
    'household',
    ...(manager ? (['alerts'] as const) : []),
    'access',
    ...(manager ? (['camera'] as const) : []),
    'storage',
    ...(manager ? (['security'] as const) : []),
    'account',
    'privacy',
  ];
  const [selected, setSelected] = useState<SettingsSection>(() => {
    const requested = new URLSearchParams(window.location.search).get(
      'section',
    ) as SettingsSection | null;
    return requested && sections.includes(requested) ? requested : 'household';
  });

  return (
    <div className="settings-workspace wide">
      <nav className="settings-nav" aria-label="Settings categories">
        {sections.map((section) => (
          <button
            aria-current={selected === section ? 'page' : undefined}
            className={selected === section ? 'is-active' : ''}
            key={section}
            onClick={() => setSelected(section)}
            type="button"
          >
            {labels[section]}
          </button>
        ))}
      </nav>

      <div className="settings-layout">
        <header className="settings-section-heading">
          <h3>{labels[selected]}</h3>
        </header>

        {selected === 'household' && (
          <section className="settings-section" aria-label="Household">
            <HouseholdSwitcher currentHouseholdId={household.id} />
          </section>
        )}
        {selected === 'alerts' && manager && (
          <section className="settings-section" aria-label="Alerts">
            <NotificationSettings />
          </section>
        )}
        {selected === 'access' && (
          <section className="settings-section" aria-label="People and access">
            <HouseholdSharingSettings cameras={cameras} role={household.role} />
          </section>
        )}
        {selected === 'camera' && manager && (
          <section className="settings-section" aria-label="Camera and motion">
            <MotionRetentionSettings />
          </section>
        )}
        {selected === 'storage' && (
          <section className="settings-section" aria-label="Cloud storage">
            <GoogleDriveSettings />
          </section>
        )}
        {selected === 'security' && manager && (
          <section
            className="settings-section settings-section-stack"
            aria-label="Security"
          >
            <BrowserSessions onCurrentRevoked={onCurrentSessionRevoked} />
            <AccessHistory currentEmail={user.email} />
          </section>
        )}
        {selected === 'account' && (
          <section
            className="settings-section settings-section-stack"
            aria-label="Account"
          >
            <div className="settings-row settings-row-identity">
              <div className="settings-identity">
                <Avatar
                  email={user.email}
                  avatarUrl={user.avatarUrl}
                  size="lg"
                />
                <div>
                  <strong>{user.email}</strong>
                  <p>Signed in</p>
                </div>
              </div>
              <button className="secondary" onClick={onLogout}>
                Sign out
              </button>
            </div>
            <EmailVerification verified={Boolean(user.emailVerified)} />
            <LinkGoogleAccount linked={Boolean(user.googleLinked)} />
            <div className="settings-row settings-danger">
              <div>
                <strong>Delete account</strong>
                <p>Permanently removes your Beacon data and access.</p>
              </div>
              <button className="danger" onClick={onDeleteAccount}>
                Delete account
              </button>
            </div>
          </section>
        )}
        {selected === 'privacy' && (
          <section className="settings-section" aria-label="Privacy">
            <div className="settings-row">
              <div>
                <strong>Trust &amp; privacy</strong>
                <p>Capture, sharing, retention, and account data.</p>
              </div>
              <a className="secondary button-link" href="/trust">
                View details
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
