import { useEffect, useMemo, useRef, useState } from 'react';

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
import { AutosaveIndicator, SettingsAutosaveProvider } from './SettingsAutosave';
import { SetPassword } from './SetPassword';
import { SettingsRow } from './SettingsUI';
import type { Camera, HouseholdSession, User } from './domain';

type SettingsPageProps = {
  user: User;
  household: HouseholdSession;
  cameras: Camera[];
  /** Bumped whenever a household event says membership, invitations, or
   * grants changed elsewhere -- People & access reloads when this changes
   * instead of only ever reflecting its own actions. */
  membershipRevision: number;
  /** The section named in the URL (?section=...) to scroll to on load, so
   * an external deep link (e.g. "Connect Drive" from the live view) lands
   * on the right part of the page. Every section is always on the page --
   * this only controls the initial scroll position and jump-nav highlight. */
  requestedSection: string | null;
  onSectionChange: (section: SettingsSection) => void;
  onDeleteAccount: () => void;
  onCurrentSessionRevoked: (message?: string) => void;
  onUserChanged: () => void;
};

type SettingsSection =
  | 'household'
  | 'notifications'
  | 'access'
  | 'data'
  | 'security'
  | 'account'
  | 'privacy';

/** Older links may still point at the section name this page used before
 * "storage" merged into "data" -- resolve it instead of silently failing
 * to scroll. */
const legacySectionAliases: Record<string, string> = {
  alerts: 'notifications',
  camera: 'data',
  storage: 'storage',
};

const sectionInfo: Record<SettingsSection, { label: string; icon: IconName }> = {
  household: { label: 'Household', icon: 'home' },
  notifications: { label: 'Notifications', icon: 'alert' },
  access: { label: 'People & access', icon: 'users' },
  data: { label: 'Data & storage', icon: 'cloud' },
  security: { label: 'Security', icon: 'shield' },
  account: { label: 'Account', icon: 'user' },
  privacy: { label: 'Privacy', icon: 'lock' },
};

export function SettingsPage({
  user,
  household,
  cameras,
  membershipRevision,
  requestedSection,
  onSectionChange,
  onDeleteAccount,
  onCurrentSessionRevoked,
  onUserChanged,
}: SettingsPageProps) {
  const manager = household.role === 'owner' || household.role === 'admin';
  const sections: SettingsSection[] = useMemo(
    () => [
      'household',
      ...(manager ? (['notifications'] as const) : []),
      'access',
      'data',
      ...(manager ? (['security'] as const) : []),
      'account',
      'privacy',
    ],
    [manager],
  );

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
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
  }, []);

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
        if (element.getBoundingClientRect().top - parentTop <= threshold) {
          current = section;
        } else {
          break;
        }
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
        <nav className="settings-jump" aria-label="Settings sections">
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
            <h2>Household</h2>
            <HouseholdSwitcher
              currentHouseholdId={household.id}
              memberCount={manager ? memberCount : null}
              cameraCount={cameras.length}
            />
          </section>

          {manager && (
            <section
              id="notifications"
              className="settings-section"
              ref={(element) => {
                sectionRefs.current.notifications = element;
              }}
            >
              <h2>Notifications</h2>
              <NotificationSettings />
            </section>
          )}

          <section
            id="access"
            className="settings-section"
            ref={(element) => {
              sectionRefs.current.access = element;
            }}
          >
            <h2>People &amp; access</h2>
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
            <h2>Data &amp; storage</h2>
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
              <h2>Security</h2>
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
            <h2>Account</h2>
            <SettingsRow
              title={user.email}
              description={
                user.emailVerified ? 'Verified' : undefined
              }
            >
              <Avatar email={user.email} avatarUrl={user.avatarUrl} size="lg" />
            </SettingsRow>
            {!user.emailVerified && <EmailVerification verified={false} />}
            <div className="settings-subsection">
              <h3>Sign-in methods</h3>
              {!user.hasPassword && <SetPassword onSet={onUserChanged} />}
              <LinkGoogleAccount linked={Boolean(user.googleLinked)} />
            </div>
            <div className="danger-zone">
              <SettingsRow
                title="Delete account"
                description="Permanently removes your Beacon data and access."
              >
                <button className="quiet-button quiet-button-danger" onClick={onDeleteAccount}>
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
            <h2>Privacy</h2>
            <SettingsRow
              title="Trust &amp; privacy"
              description="How Beacon handles capture, sharing, retention and account data."
            >
              <a className="secondary button-link" href="/trust">
                View details
              </a>
            </SettingsRow>
          </section>
        </div>
      </div>
    </SettingsAutosaveProvider>
  );
}
