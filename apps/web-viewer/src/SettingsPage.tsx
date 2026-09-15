import { useState } from 'react';
import type { IconName } from './Icon';

import { AccessHistory } from './AccessHistory';
import { Avatar } from './Avatar';
import { BrowserSessions } from './BrowserSessions';
import { EmailVerification } from './EmailVerification';
import { GoogleDriveSettings } from './GoogleDriveSettings';
import { HouseholdSharingSettings } from './HouseholdSharingSettings';
import { HouseholdSwitcher } from './HouseholdSwitcher';
import { Icon } from './Icon';
import { LinkGoogleAccount } from './LinkGoogleAccount';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import { NotificationSettings } from './NotificationSettings';
import { SettingsRow, SettingsSectionHeader } from './SettingsUI';
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

const sectionInfo: Record<
  SettingsSection,
  { label: string; icon: IconName; description: string }
> = {
  household: {
    label: 'Household',
    icon: 'home',
    description: 'The household this account belongs to.',
  },
  alerts: {
    label: 'Alerts',
    icon: 'alert',
    description: 'Push delivery and per-camera alert preferences.',
  },
  access: {
    label: 'People & access',
    icon: 'users',
    description: 'Who can view or share this household, and what they can do.',
  },
  camera: {
    label: 'Camera & motion',
    icon: 'camera',
    description: 'How long motion history is kept.',
  },
  storage: {
    label: 'Cloud storage',
    icon: 'cloud',
    description: 'Connect Google Drive for Beacon app data and recordings.',
  },
  security: {
    label: 'Security',
    icon: 'shield',
    description: 'Active browser sessions and recent account access.',
  },
  account: {
    label: 'Account',
    icon: 'user',
    description: 'Sign-in methods, verification, and account deletion.',
  },
  privacy: {
    label: 'Privacy',
    icon: 'lock',
    description: 'Capture, sharing, retention, and account data.',
  },
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
  const active = sectionInfo[selected];

  return (
    <div className="settings-workspace">
      <nav className="settings-nav" aria-label="Settings categories">
        {sections.map((section) => (
          <button
            aria-current={selected === section ? 'page' : undefined}
            className={selected === section ? 'is-active' : ''}
            key={section}
            onClick={() => setSelected(section)}
            type="button"
          >
            <Icon name={sectionInfo[section].icon} />
            {sectionInfo[section].label}
          </button>
        ))}
      </nav>

      <div className="settings-layout">
        <SettingsSectionHeader
          title={active.label}
          description={active.description}
        />

        {selected === 'household' && (
          <div aria-label="Household">
            <HouseholdSwitcher currentHouseholdId={household.id} />
          </div>
        )}
        {selected === 'alerts' && manager && (
          <div aria-label="Alerts">
            <NotificationSettings />
          </div>
        )}
        {selected === 'access' && (
          <div aria-label="People and access">
            <HouseholdSharingSettings cameras={cameras} role={household.role} />
          </div>
        )}
        {selected === 'camera' && manager && (
          <div aria-label="Camera and motion">
            <MotionRetentionSettings />
          </div>
        )}
        {selected === 'storage' && (
          <div aria-label="Cloud storage">
            <GoogleDriveSettings />
          </div>
        )}
        {selected === 'security' && manager && (
          <div aria-label="Security" className="settings-card-stack">
            <BrowserSessions onCurrentRevoked={onCurrentSessionRevoked} />
            <AccessHistory currentEmail={user.email} />
          </div>
        )}
        {selected === 'account' && (
          <div aria-label="Account" className="settings-card-stack">
            <SettingsRow title={user.email} description="Signed in">
              <Avatar email={user.email} avatarUrl={user.avatarUrl} size="lg" />
              <button className="secondary" onClick={onLogout}>
                Sign out
              </button>
            </SettingsRow>
            <EmailVerification verified={Boolean(user.emailVerified)} />
            <LinkGoogleAccount linked={Boolean(user.googleLinked)} />
            <SettingsRow
              title="Delete account"
              description="Permanently removes your Beacon data and access."
              tone="danger"
            >
              <button className="danger" onClick={onDeleteAccount}>
                Delete account
              </button>
            </SettingsRow>
          </div>
        )}
        {selected === 'privacy' && (
          <div aria-label="Privacy">
            <SettingsRow
              title="Trust & privacy"
              description="Capture, sharing, retention, and account data."
            >
              <a className="secondary button-link" href="/trust">
                View details
              </a>
            </SettingsRow>
          </div>
        )}
      </div>
    </div>
  );
}
