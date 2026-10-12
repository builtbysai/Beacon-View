import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type { IconName } from './Icon';

import { AccessHistory } from './AccessHistory';
import { AppDownloads } from './AppDownloads';
import { UpdateStatusCard } from './UpdateStatusCard';
import { Avatar } from './Avatar';
import { AudioSettings } from './AudioSettings';
import { ViewingSettings } from './ViewingSettings';
import { HouseholdModeSettings } from './HouseholdModeSettings';
import { BrowserSessions } from './BrowserSessions';
import { DesktopComputerSettings } from './DesktopComputerSettings';
import { desktopSupportsAutostart } from './desktop-shell';
import { EmailVerification } from './EmailVerification';
import { GoogleDriveSettings } from './GoogleDriveSettings';
import { HouseholdSharingSettings } from './HouseholdSharingSettings';
import { HouseholdSwitcher } from './HouseholdSwitcher';
import { Icon } from './Icon';
import { LinkGoogleAccount } from './LinkGoogleAccount';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import { NotificationSettings } from './NotificationSettings';
import {
  AutosaveIndicator,
  SettingsAutosaveProvider,
} from './SettingsAutosave';
import { SetPassword } from './SetPassword';
import { SettingsRow } from './SettingsUI';
import type { Camera, HouseholdSession, User } from './domain';
import './SettingsV7Polish.css';

type SettingsPageProps = {
  user: User;
  household: HouseholdSession;
  cameras: Camera[];
  membershipRevision: number;
  googleAvailable?: boolean;
  webPushAvailable?: boolean;
  requestedSection: string | null;
  onSectionChange: (section: SettingsSection) => void;
  onDeleteAccount: () => void;
  onCurrentSessionRevoked: (message?: string) => void;
  onUserChanged: () => void;
};

type SettingsSection =
  | 'household'
  | 'computer'
  | 'audio'
  | 'viewing'
  | 'apps'
  | 'modes'
  | 'notifications'
  | 'access'
  | 'data'
  | 'security'
  | 'account'
  | 'privacy';

const legacySectionAliases: Record<string, string> = {
  alerts: 'notifications',
  camera: 'data',
  storage: 'storage',
};

/** The settings are grouped by what they change: the shared household, alerts and storage, this
 * device alone, and the signed-in account. */
const sectionGroups: Array<{ label: string; sections: SettingsSection[] }> = [
  { label: 'Household', sections: ['household', 'access', 'modes'] },
  { label: 'Alerts & storage', sections: ['notifications', 'data'] },
  {
    label: 'This device',
    sections: ['computer', 'audio', 'viewing', 'apps'],
  },
  { label: 'Account', sections: ['account', 'security', 'privacy'] },
];

const sectionInfo: Record<SettingsSection, { label: string; icon: IconName }> =
  {
    household: { label: 'Household', icon: 'home' },
    computer: { label: 'This computer', icon: 'browser' },
    audio: { label: 'Audio', icon: 'speaker' },
    viewing: { label: 'Viewing', icon: 'eye' },
    apps: { label: 'Apps & updates', icon: 'download' },
    modes: { label: 'Home & Away', icon: 'home' },
    notifications: { label: 'Notifications', icon: 'alert' },
    access: { label: 'People & access', icon: 'users' },
    data: { label: 'Data & storage', icon: 'cloud' },
    security: { label: 'Security', icon: 'shield' },
    account: { label: 'Account', icon: 'user' },
    privacy: { label: 'Privacy', icon: 'lock' },
  };

const sectionText: Record<SettingsSection, [string, string]> = {
  household: ['Household', 'Your shared Beacon space.'],
  access: [
    'People & access',
    'Manage who belongs to this household and what they can access.',
  ],
  modes: [
    'Home & Away',
    'Quiet motion alerts and pause cameras while someone is home.',
  ],
  notifications: [
    'Notifications',
    'Control browser delivery and alerts from each camera.',
  ],
  data: [
    'Data & storage',
    'Choose how long event metadata is kept and where optional cloud data is stored.',
  ],
  computer: [
    'This computer',
    'How the Beacon desktop app runs on this computer.',
  ],
  audio: ['Audio', 'Choose the microphone you use to talk through cameras.'],
  viewing: ['Viewing', 'How this device watches your cameras.'],
  apps: [
    'Apps & updates',
    'Get Beacon on your other devices and keep this one up to date.',
  ],
  account: ['Account', 'Manage how you sign in and your Beacon account.'],
  security: [
    'Security',
    'Review signed-in browsers and security-relevant camera access.',
  ],
  privacy: [
    'Privacy',
    'Understand the data Beacon keeps and where to find the full details.',
  ],
};
const titleOf = (section: SettingsSection) => sectionText[section][0];
const descriptionOf = (section: SettingsSection) => sectionText[section][1];

function SectionHead({ title, children }: { title: string; children: string }) {
  return (
    <div className="settings-section-head">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function SettingsPage({
  user,
  household,
  cameras,
  membershipRevision,
  googleAvailable = true,
  webPushAvailable = true,
  requestedSection,
  onSectionChange,
  onDeleteAccount,
  onCurrentSessionRevoked,
  onUserChanged,
}: SettingsPageProps) {
  const manager = household.role === 'owner' || household.role === 'admin';
  // Viewers can ask for alerts about the cameras they were given (V43).
  const canReceiveAlerts = manager || household.role === 'viewer';
  const [desktopApp] = useState(desktopSupportsAutostart);
  const available = useMemo<Record<SettingsSection, boolean>>(
    () => ({
      household: true,
      access: true,
      modes: manager,
      notifications: canReceiveAlerts,
      data: true,
      computer: desktopApp,
      audio: true,
      viewing: true,
      apps: true,
      account: true,
      security: manager,
      privacy: true,
    }),
    [desktopApp, manager, canReceiveAlerts],
  );
  const groups = useMemo(
    () =>
      sectionGroups
        .map((group) => ({
          ...group,
          sections: group.sections.filter((section) => available[section]),
        }))
        .filter((group) => group.sections.length > 0),
    [available],
  );
  const sections = useMemo(
    () => groups.flatMap((group) => group.sections),
    [groups],
  );

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const jumpNavRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    sections[0]!,
  );
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    const target =
      requestedSection &&
      (legacySectionAliases[requestedSection] ?? requestedSection);
    if (!target) return;
    const timer = setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ block: 'start' });
    }, 150);
    return () => clearTimeout(timer);
  }, [requestedSection]);

  useEffect(() => {
    const elements = sections
      .map((section) => sectionRefs.current[section])
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const scrollParent = elements[0]!.closest('.main-content');
    if (!scrollParent) return;

    let frame = 0;
    function update() {
      frame = 0;
      const parentTop = scrollParent!.getBoundingClientRect().top;
      let current = sections[0]!;
      for (const section of sections) {
        const element = sectionRefs.current[section];
        if (!element) continue;
        const scrollMarginTop =
          parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
        const threshold = scrollMarginTop + 6;
        if (element.getBoundingClientRect().top - parentTop <= threshold)
          current = section;
        else break;
      }
      setActiveSection(current);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  useEffect(() => {
    const nav = jumpNavRef.current;
    if (!nav || !window.matchMedia('(max-width: 900px)').matches) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="true"]');
    if (!active) return;

    const targetLeft =
      active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({
      behavior: 'smooth',
      left: Math.max(0, targetLeft),
    });
  }, [activeSection]);

  function jumpTo(section: SettingsSection) {
    sectionRefs.current[section]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setActiveSection(section);
    onSectionChange(section);
  }

  const content: Record<SettingsSection, ReactNode> = {
    household: (
      <>
        <HouseholdSwitcher
          currentHouseholdId={household.id}
          memberCount={manager ? memberCount : null}
          cameraCount={cameras.length}
        />
      </>
    ),
    computer: (
      <>
        <DesktopComputerSettings />
      </>
    ),
    audio: (
      <>
        <AudioSettings />
      </>
    ),
    viewing: (
      <>
        <ViewingSettings />
      </>
    ),
    modes: (
      <>
        <HouseholdModeSettings />
      </>
    ),
    notifications: (
      <>
        <NotificationSettings
          key={`notifications_${user.id}_${household.id}`}
          webPushAvailable={webPushAvailable}
        />
      </>
    ),
    access: (
      <>
        <HouseholdSharingSettings
          cameras={cameras}
          role={household.role}
          refreshRevision={membershipRevision}
          onMemberCountChange={setMemberCount}
        />
      </>
    ),
    data: (
      <>
        {manager && <MotionRetentionSettings />}
        <div id="storage">
          <GoogleDriveSettings />
        </div>
      </>
    ),
    security: (
      <>
        <BrowserSessions onCurrentRevoked={onCurrentSessionRevoked} />
        <AccessHistory currentEmail={user.email} />
      </>
    ),
    apps: (
      <>
        <UpdateStatusCard />
        <AppDownloads variant="app" />
      </>
    ),
    account: (
      <>
        <div className="settings-card settings-account-card">
          <SettingsRow
            title={user.email}
            description={
              user.emailVerified ? 'Email verified' : 'Email not verified'
            }
          >
            <Avatar email={user.email} avatarUrl={user.avatarUrl} size="lg" />
          </SettingsRow>
          {!user.emailVerified && <EmailVerification verified={false} />}
          <div className="settings-account-methods">
            <h3>Sign-in methods</h3>
            {!user.hasPassword && <SetPassword onSet={onUserChanged} />}
            <LinkGoogleAccount
              linked={Boolean(user.googleLinked)}
              available={googleAvailable}
            />
          </div>
        </div>
        <div className="settings-card settings-card-danger settings-danger-card">
          <SettingsRow
            title="Delete account"
            description="Permanently removes your Beacon account, data and access."
          >
            <button
              className="quiet-button quiet-button-danger"
              onClick={onDeleteAccount}
            >
              Delete account
            </button>
          </SettingsRow>
        </div>
      </>
    ),
    privacy: (
      <>
        <div className="settings-card privacy-settings-card">
          <div className="privacy-settings-intro">
            <h3>Your privacy defaults</h3>
            <p>
              The important parts are summarized here. Full technical details
              remain on Trust &amp; privacy.
            </p>
          </div>
          <div className="privacy-settings-facts">
            <div>
              <strong>Motion history</strong>
              <span>
                Event time, camera and motion metadata follow your retention
                setting.
              </span>
            </div>
            <div>
              <strong>Security activity</strong>
              <span>
                Session and access history is shown without a device
                fingerprint.
              </span>
            </div>
            <div>
              <strong>Cloud storage</strong>
              <span>
                Google Drive is optional and recording is controlled separately.
              </span>
            </div>
          </div>
          <SettingsRow
            title="Trust & privacy"
            description="Capture, sharing, retention and account-data details."
          >
            <a className="secondary button-link" href="/trust">
              View details
            </a>
          </SettingsRow>
        </div>
      </>
    ),
  };

  return (
    <SettingsAutosaveProvider>
      <div className="settings-shell">
        <nav
          ref={jumpNavRef}
          className="settings-jump"
          aria-label="Settings sections"
        >
          {groups.map((group) => (
            <div key={group.label} className="settings-jump-group">
              <span className="settings-jump-label">{group.label}</span>
              {group.sections.map((section) => (
                <a
                  key={section}
                  href={`#${section}`}
                  className="settings-jump-item"
                  aria-current={activeSection === section ? 'true' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(section);
                  }}
                >
                  <Icon name={sectionInfo[section].icon} />
                  {sectionInfo[section].label}
                </a>
              ))}
            </div>
          ))}
          <AutosaveIndicator />
        </nav>

        <div className="settings-sections">
          {sections.map((section) => (
            <section
              key={section}
              id={section}
              className="settings-section"
              ref={(element) => {
                sectionRefs.current[section] = element;
              }}
            >
              <SectionHead title={titleOf(section)}>
                {descriptionOf(section)}
              </SectionHead>
              {content[section]}
            </section>
          ))}
        </div>
      </div>
    </SettingsAutosaveProvider>
  );
}
