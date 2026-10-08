import { useEffect, useMemo, useRef, useState } from 'react';

import type { IconName } from './Icon';

import { AccessHistory } from './AccessHistory';
import { Avatar } from './Avatar';
import { AudioSettings } from './AudioSettings';
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

const sectionInfo: Record<SettingsSection, { label: string; icon: IconName }> =
  {
    household: { label: 'Household', icon: 'home' },
    computer: { label: 'This computer', icon: 'browser' },
    audio: { label: 'Audio', icon: 'speaker' },
    notifications: { label: 'Notifications', icon: 'alert' },
    access: { label: 'People & access', icon: 'users' },
    data: { label: 'Data & storage', icon: 'cloud' },
    security: { label: 'Security', icon: 'shield' },
    account: { label: 'Account', icon: 'user' },
    privacy: { label: 'Privacy', icon: 'lock' },
  };

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
  const [desktopApp] = useState(desktopSupportsAutostart);
  const sections: SettingsSection[] = useMemo(
    () => [
      'household',
      ...(desktopApp ? (['computer'] as const) : []),
      'audio',
      ...(manager ? (['notifications'] as const) : []),
      'access',
      'data',
      ...(manager ? (['security'] as const) : []),
      'account',
      'privacy',
    ],
    [desktopApp, manager],
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

  return (
    <SettingsAutosaveProvider>
      <div className="settings-shell">
        <nav
          ref={jumpNavRef}
          className="settings-jump"
          aria-label="Settings sections"
        >
          <span className="settings-jump-label" aria-hidden="true">
            Settings
          </span>
          {sections.map((section) => (
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
          <AutosaveIndicator />
        </nav>

        <div className="settings-sections">
          <section
            id="household"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.household = element;
            }}
          >
            <SectionHead title="Household">
              Your shared Beacon space.
            </SectionHead>
            <HouseholdSwitcher
              currentHouseholdId={household.id}
              memberCount={manager ? memberCount : null}
              cameraCount={cameras.length}
            />
          </section>

          {desktopApp && (
            <section
              id="computer"
              className="settings-section"
              ref={(element) => {
                sectionRefs.current.computer = element;
              }}
            >
              <SectionHead title="This computer">
                How the Beacon desktop app runs on this computer.
              </SectionHead>
              <DesktopComputerSettings />
            </section>
          )}

          <section
            id="audio"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.audio = element;
            }}
          >
            <SectionHead title="Audio">
              Choose the microphone you use to talk through cameras.
            </SectionHead>
            <AudioSettings />
          </section>

          {manager && (
            <section
              id="notifications"
              className="settings-section"
              ref={(element) => {
                sectionRefs.current.notifications = element;
              }}
            >
              <SectionHead title="Notifications">
                Control browser delivery and alerts from each camera.
              </SectionHead>
              <NotificationSettings webPushAvailable={webPushAvailable} />
            </section>
          )}

          <section
            id="access"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.access = element;
            }}
          >
            <SectionHead title="People & access">
              Manage who belongs to this household and what they can access.
            </SectionHead>
            <HouseholdSharingSettings
              cameras={cameras}
              role={household.role}
              refreshRevision={membershipRevision}
              onMemberCountChange={setMemberCount}
            />
          </section>

          <section
            id="data"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.data = element;
            }}
          >
            <SectionHead title="Data & storage">
              Choose how long event metadata is kept and where optional cloud
              data is stored.
            </SectionHead>
            {manager && <MotionRetentionSettings />}
            <div id="storage">
              <GoogleDriveSettings />
            </div>
          </section>

          {manager && (
            <section
              id="security"
              className="settings-section"
              ref={(element) => {
                sectionRefs.current.security = element;
              }}
            >
              <SectionHead title="Security">
                Review signed-in browsers and security-relevant camera access.
              </SectionHead>
              <BrowserSessions onCurrentRevoked={onCurrentSessionRevoked} />
              <AccessHistory currentEmail={user.email} />
            </section>
          )}

          <section
            id="account"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.account = element;
            }}
          >
            <SectionHead title="Account">
              Manage how you sign in and your Beacon account.
            </SectionHead>
            <div className="settings-card settings-account-card">
              <SettingsRow
                title={user.email}
                description={
                  user.emailVerified ? 'Email verified' : 'Email not verified'
                }
              >
                <Avatar
                  email={user.email}
                  avatarUrl={user.avatarUrl}
                  size="lg"
                />
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
          </section>

          <section
            id="privacy"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.privacy = element;
            }}
          >
            <SectionHead title="Privacy">
              Understand the data Beacon keeps and where to find the full
              details.
            </SectionHead>
            <div className="settings-card privacy-settings-card">
              <div className="privacy-settings-intro">
                <h3>Your privacy defaults</h3>
                <p>
                  The important parts are summarized here. Full technical
                  details remain on Trust &amp; privacy.
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
                    Google Drive is optional and recording is controlled
                    separately.
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
          </section>
        </div>
      </div>
    </SettingsAutosaveProvider>
  );
}
