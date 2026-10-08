import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import type { Camera, HouseholdRole } from './domain';
import './HouseholdSharingSettings.css';

interface CameraGrant {
  cameraId: string;
  cameraName: string;
  canListen: boolean;
  canTalk: boolean;
  canFlip: boolean;
  canPause: boolean;
}

interface Member {
  email: string;
  expiresAt: string | null;
  grants: CameraGrant[];
  id: string;
  role: HouseholdRole;
  status: 'active' | 'revoked';
}

interface Invitation {
  createdAt: string;
  expiresAt: string;
  id: string;
  invitedEmail: string;
  role: Exclude<HouseholdRole, 'owner'>;
}

interface SharingState {
  invitations: Invitation[];
  members: Member[];
}

interface GuestLink {
  cameraIds: string[];
  canFlip: boolean;
  canListen: boolean;
  canPause: boolean;
  canTalk: boolean;
  createdAt: string;
  expiresAt: string;
  id: string;
  label: string | null;
}

type OutstandingShare =
  | { kind: 'invitation'; data: Invitation }
  | { kind: 'guestLink'; data: GuestLink };

const MEMBERS_REVEAL_INITIAL = 8;
const MEMBERS_REVEAL_STEP = 8;

function joinLink(token: string): string {
  return `${window.location.origin}/join?token=${encodeURIComponent(token)}`;
}

function guestViewLink(token: string): string {
  return `${window.location.origin}/g/${encodeURIComponent(token)}`;
}

export function HouseholdSharingSettings({
  cameras,
  role,
  refreshRevision = 0,
  onMemberCountChange,
}: {
  cameras: Camera[];
  role: HouseholdRole;
  /** Bumped when a household event reports that membership, invitations,
   * or grants changed elsewhere (another admin's tab, or the invited
   * person accepting) -- reloads this screen without a manual refresh. */
  refreshRevision?: number;
  /** Reports the real active-member count up so Household can show it
   * without this component's own fetch being duplicated. */
  onMemberCountChange?: (count: number) => void;
}) {
  const canManage = role === 'owner' || role === 'admin';
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [guestLinks, setGuestLinks] = useState<GuestLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [manageMember, setManageMember] = useState<Member | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Member | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [resentInvite, setResentInvite] = useState<{
    email: string;
    code: string;
  } | null>(null);
  const [visibleMembers, setVisibleMembers] = useState(MEMBERS_REVEAL_INITIAL);

  const load = useCallback(async () => {
    if (!canManage) return;
    const [result, links] = await Promise.all([
      request<SharingState>('/api/household/sharing'),
      request<{ guestLinks: GuestLink[] }>('/api/household/guest-links'),
    ]);
    setSharing(result);
    setGuestLinks(links.guestLinks);
  }, [canManage]);

  useEffect(() => {
    void load().catch((caught) =>
      setError(
        friendlyError(
          caught,
          'Sharing settings couldn’t be loaded. Try again.',
        ),
      ),
    );
    // refreshRevision is never read in the body -- it's here purely as a
    // signal to reload when a household event says something changed.
  }, [load, refreshRevision]);

  useEffect(() => {
    if (sharing) {
      onMemberCountChange?.(
        sharing.members.filter((member) => member.status === 'active').length,
      );
    }
  }, [onMemberCountChange, sharing]);

  async function createInvitation(
    formData: FormData,
  ): Promise<{ code: string; expiresAt: string }> {
    const roleValue = formData.get('role');
    const invitedRole =
      roleValue === 'admin' || roleValue === 'guest' ? roleValue : 'viewer';
    const result = await request<{ expiresAt: string; token: string }>(
      '/api/household/invitations',
      {
        body: JSON.stringify({
          email: formData.get('email'),
          role: invitedRole,
          ...(invitedRole === 'guest'
            ? { expiresInHours: Number(formData.get('expiresInHours')) }
            : {}),
          ...(invitedRole === 'viewer'
            ? {
                defaultCanListen: formData.get('defaultCanListen') === 'on',
                defaultCanTalk: formData.get('defaultCanTalk') === 'on',
                defaultCanFlip: formData.get('defaultCanFlip') === 'on',
                defaultCanPause: formData.get('defaultCanPause') === 'on',
              }
            : {}),
        }),
        method: 'POST',
      },
    );
    await load();
    return { code: result.token, expiresAt: result.expiresAt };
  }

  async function createGuestLink(
    formData: FormData,
  ): Promise<{ token: string; expiresAt: string }> {
    const cameraIds = formData.getAll('cameraIds').map(String);
    const label = formData.get('label');
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    const result = await request<{ expiresAt: string; token: string }>(
      '/api/household/guest-links',
      {
        body: JSON.stringify({
          cameraIds,
          canListen: formData.get('canListen') === 'on',
          canTalk: formData.get('canTalk') === 'on',
          canFlip: formData.get('canFlip') === 'on',
          canPause: formData.get('canPause') === 'on',
          expiresInHours: Number(formData.get('expiresInHours')),
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
        }),
        method: 'POST',
      },
    );
    await load();
    return result;
  }

  async function acceptInvitation(code: string) {
    const accepted = await request<{ householdId: string }>(
      '/api/household/invitations/accept',
      { body: JSON.stringify({ token: code }), method: 'POST' },
    );
    await request('/api/account/household', {
      body: JSON.stringify({ householdId: accepted.householdId }),
      method: 'PUT',
    });
    window.location.assign('/');
  }

  async function resendInvitation(invitation: Invitation) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request<{ expiresAt: string; token: string }>(
        `/api/household/invitations/${invitation.id}/resend`,
        { method: 'POST' },
      );
      setResentInvite({ email: invitation.invitedEmail, code: result.token });
      await load();
    } catch (caught) {
      setError(
        friendlyError(caught, 'The invitation couldn’t be resent. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/household/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      setMessage(`Invitation for ${invitation.invitedEmail} revoked.`);
      await load();
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'The invitation couldn’t be cancelled. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeMember(member: Member) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/household/members/${member.id}`, {
        method: 'DELETE',
      });
      setMessage(`${member.email} no longer has household access.`);
      setConfirmRevoke(null);
      await load();
    } catch (caught) {
      setError(friendlyError(caught, 'Access couldn’t be revoked. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeMemberPermanently(member: Member) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/household/members/${member.id}/permanently`, {
        method: 'DELETE',
      });
      setMessage(`${member.email} removed from the household.`);
      setConfirmRemove(null);
      await load();
    } catch (caught) {
      setError(
        friendlyError(caught, 'That person couldn’t be removed. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeGuestLink(link: GuestLink) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/household/guest-links/${link.id}`, {
        method: 'DELETE',
      });
      setMessage(`Guest link ${link.label ?? ''} revoked.`.trim());
      await load();
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'The guest link couldn’t be turned off. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveGrants(member: Member, grants: CameraGrant[]) {
    await request(`/api/household/members/${member.id}/grants`, {
      body: JSON.stringify({
        grants: grants.map((grant) => ({
          cameraId: grant.cameraId,
          canListen: grant.canListen,
          canTalk: grant.canTalk,
          canFlip: grant.canFlip,
          canPause: grant.canPause,
        })),
      }),
      method: 'PUT',
    });
    await load();
  }

  if (!canManage) {
    return (
      <div className="people-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setJoinOpen(true)}
        >
          Join household
        </button>
        {joinOpen && (
          <JoinHouseholdDialog
            onJoin={acceptInvitation}
            onDismiss={() => setJoinOpen(false)}
          />
        )}
      </div>
    );
  }

  const outstanding: OutstandingShare[] = [
    ...(sharing?.invitations.map((data): OutstandingShare => ({
      data,
      kind: 'invitation',
    })) ?? []),
    ...guestLinks.map((data): OutstandingShare => ({
      data,
      kind: 'guestLink',
    })),
  ].sort(
    (a, b) =>
      new Date(b.data.createdAt).getTime() -
      new Date(a.data.createdAt).getTime(),
  );

  const members = sharing?.members ?? [];
  const visible = members.slice(0, visibleMembers);
  const remaining = members.length - visible.length;

  return (
    <div>
      <div className="people-actions">
        <button
          type="button"
          className="primary"
          onClick={() => setInviteOpen(true)}
        >
          Invite person
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setJoinOpen(true)}
        >
          Join household
        </button>
      </div>

      {message && (
        <p role="status" className="settings-card-inline-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}

      {sharing === null ? (
        <p className="settings-card-inline-message">Loading…</p>
      ) : members.length === 0 && outstanding.length === 0 ? (
        <p className="settings-card-empty">No household members.</p>
      ) : (
        <ul className="member-list">
          {visible.map((member) => (
            <li className="member-row" key={member.id}>
              <Avatar email={member.email} size="md" />
              <div className="member-identity">
                <strong>{member.email}</strong>
                <span>
                  {member.role[0]!.toUpperCase()}
                  {member.role.slice(1)}
                  {member.status === 'revoked' && ' · Access removed'}
                  {(member.role === 'viewer' || member.role === 'guest') &&
                    member.status === 'active' &&
                    ` · ${member.grants.length} camera${member.grants.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {(member.role === 'viewer' || member.role === 'guest') && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setManageMember(member)}
                >
                  Manage
                </button>
              )}
              {member.role === 'admin' &&
                (role === 'owner' || member.role !== 'admin') && (
                  <button
                    type="button"
                    className="quiet-button quiet-button-danger"
                    onClick={() => setConfirmRevoke(member)}
                  >
                    Remove access
                  </button>
                )}
            </li>
          ))}
          {outstanding.map((item) =>
            item.kind === 'invitation' ? (
              <li className="member-row" key={`invitation-${item.data.id}`}>
                <span className="member-pending-icon">
                  <Icon name="user" />
                </span>
                <div className="member-identity">
                  <strong>{item.data.invitedEmail}</strong>
                  <span>
                    Pending invitation · {item.data.role} · expires{' '}
                    {new Date(item.data.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                {(role === 'owner' || item.data.role !== 'admin') && (
                  <div className="member-row-actions">
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={busy}
                      onClick={() => void resendInvitation(item.data)}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      className="quiet-button quiet-button-danger"
                      disabled={busy}
                      onClick={() => void revokeInvitation(item.data)}
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </li>
            ) : (
              <li className="member-row" key={`guest-link-${item.data.id}`}>
                <span className="member-pending-icon">
                  <Icon name="users" />
                </span>
                <div className="member-identity">
                  <strong>{item.data.label || 'Guest link'}</strong>
                  <span>
                    Guest link · {item.data.cameraIds.length} camera
                    {item.data.cameraIds.length === 1 ? '' : 's'} · expires{' '}
                    {new Date(item.data.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="quiet-button quiet-button-danger"
                  disabled={busy}
                  onClick={() => void revokeGuestLink(item.data)}
                >
                  Revoke
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {remaining > 0 && (
        <div className="notification-reveal">
          <span>
            {visible.length} of {members.length} people
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setVisibleMembers((count) =>
                Math.min(members.length, count + MEMBERS_REVEAL_STEP),
              )
            }
          >
            Load more
          </button>
        </div>
      )}

      {inviteOpen && (
        <InvitePersonDialog
          cameras={cameras}
          canInviteAdmin={role === 'owner'}
          onCreateInvitation={createInvitation}
          onCreateGuestLink={createGuestLink}
          onDismiss={() => setInviteOpen(false)}
        />
      )}
      {joinOpen && (
        <JoinHouseholdDialog
          onJoin={acceptInvitation}
          onDismiss={() => setJoinOpen(false)}
        />
      )}
      {manageMember && (
        <ManageMemberDialog
          member={manageMember}
          cameras={cameras}
          onSave={(grants) => saveGrants(manageMember, grants)}
          onRevoke={
            manageMember.status === 'active' &&
            (role === 'owner' || manageMember.role !== 'admin')
              ? () => setConfirmRevoke(manageMember)
              : undefined
          }
          onRemove={
            manageMember.status === 'revoked' &&
            (role === 'owner' || manageMember.role !== 'admin')
              ? () => setConfirmRemove(manageMember)
              : undefined
          }
          onDismiss={() => setManageMember(null)}
        />
      )}
      {confirmRevoke && (
        <ConfirmDialog
          title={`Remove ${confirmRevoke.email}?`}
          description="They immediately lose access to every camera in this household."
          confirmLabel="Remove access"
          busy={busy}
          onConfirm={() => void revokeMember(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={`Delete ${confirmRemove.email} from the list?`}
          description="This removes their record entirely rather than just revoking access."
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void removeMemberPermanently(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      {resentInvite && (
        <ResentInviteDialog
          email={resentInvite.email}
          code={resentInvite.code}
          onDismiss={() => setResentInvite(null)}
        />
      )}
    </div>
  );
}

function JoinHouseholdDialog({
  onJoin,
  onDismiss,
}: {
  onJoin: (code: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(code.trim());
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'That invitation couldn’t be accepted. Ask for a new one.',
        ),
      );
      setBusy(false);
    }
  }

  return (
    <ModalDialog labelledBy="join-household-title" onDismiss={onDismiss}>
      <form
        className="favorites-editor join-household-dialog"
        onSubmit={(event) => void submit(event)}
      >
        <div className="favorites-editor-header">
          <div>
            <h2 id="join-household-title">Join a household</h2>
            <p>Paste the invitation code sent to your account email.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="form-group">
          <span className="form-label">Invitation code</span>
          <input
            className="input-field"
            autoComplete="off"
            autoFocus
            maxLength={512}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="settings-card-inline-message">
            {error}
          </p>
        )}
        <div className="confirm-modal-actions">
          <button type="button" className="secondary" onClick={onDismiss}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !code.trim()}
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

function ResentInviteDialog({
  email,
  code,
  onDismiss,
}: {
  email: string;
  code: string;
  onDismiss: () => void;
}) {
  const [error, setError] = useState('');

  async function copy(value: string, label: string) {
    if (!navigator.clipboard) {
      setError(
        `Clipboard access is unavailable. Select and copy the ${label}.`,
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(`Could not copy the ${label}. Select and copy it.`);
    }
  }

  return (
    <ModalDialog labelledBy="resent-invite-title" onDismiss={onDismiss}>
      <div className="favorites-editor invite-result">
        <div className="favorites-editor-header">
          <div>
            <h2 id="resent-invite-title">New invitation sent</h2>
            <p>
              A fresh code was created for {email}; the old one no longer works.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        <code>{joinLink(code)}</code>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void copy(joinLink(code), 'link')}
          >
            Copy link
          </button>
          <button type="button" className="primary" onClick={onDismiss}>
            Done
          </button>
        </div>
        <p className="invite-result-code">
          Or share the code: <code>{code}</code>{' '}
          <button
            type="button"
            className="quiet-button"
            onClick={() => void copy(code, 'code')}
          >
            Copy code
          </button>
        </p>
        {error && (
          <p role="alert" className="settings-card-inline-message">
            {error}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}

function InvitePersonDialog({
  cameras,
  canInviteAdmin,
  onCreateInvitation,
  onCreateGuestLink,
  onDismiss,
}: {
  cameras: Camera[];
  canInviteAdmin: boolean;
  onCreateInvitation: (
    data: FormData,
  ) => Promise<{ code: string; expiresAt: string }>;
  onCreateGuestLink: (
    data: FormData,
  ) => Promise<{ token: string; expiresAt: string }>;
  onDismiss: () => void;
}) {
  const [mode, setMode] = useState<'invite' | 'guestLink'>('invite');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer' | 'guest'>(
    'viewer',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<
    | { kind: 'invite'; code: string; expiresAt: string }
    | { kind: 'guestLink'; token: string; expiresAt: string }
    | null
  >(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (mode === 'invite') {
        const created = await onCreateInvitation(data);
        setResult({ kind: 'invite', ...created });
      } else {
        const created = await onCreateGuestLink(data);
        setResult({ kind: 'guestLink', ...created });
      }
    } catch (caught) {
      setError(
        friendlyError(caught, 'The invitation couldn’t be sent. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    if (!navigator.clipboard) {
      setError(
        `Clipboard access is unavailable. Select and copy the ${label}.`,
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(`Could not copy the ${label}. Select and copy it.`);
    }
  }

  return (
    <ModalDialog labelledBy="invite-person-title" onDismiss={onDismiss}>
      <div className="favorites-editor invite-person-dialog">
        <div className="favorites-editor-header">
          <div>
            <h2 id="invite-person-title">Invite person</h2>
            {!result && <p>Send an email invitation or share a guest link.</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>

        {result ? (
          <div className="invite-result">
            <p role="status">
              {result.kind === 'invite'
                ? 'Invitation created. Share this code through a trusted channel.'
                : "Guest link created. It won't be shown again after you leave this page."}
            </p>
            <code>
              {result.kind === 'invite'
                ? joinLink(result.code)
                : guestViewLink(result.token)}
            </code>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void copy(
                    result.kind === 'invite'
                      ? joinLink(result.code)
                      : guestViewLink(result.token),
                    'link',
                  )
                }
              >
                Copy link
              </button>
              <button type="button" className="primary" onClick={onDismiss}>
                Done
              </button>
            </div>
            {result.kind === 'invite' && (
              <p className="invite-result-code">
                Or share the code: <code>{result.code}</code>{' '}
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => void copy(result.code, 'code')}
                >
                  Copy code
                </button>
              </p>
            )}
            {error && (
              <p role="alert" className="settings-card-inline-message">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div
              className="sharing-mode-toggle"
              role="radiogroup"
              aria-label="How to add access"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'invite'}
                onClick={() => setMode('invite')}
              >
                Email invitation
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'guestLink'}
                onClick={() => setMode('guestLink')}
              >
                Guest link
              </button>
            </div>

            {mode === 'invite' ? (
              // A `key` here (not just a fragment) matters: without it,
              // React reconciles this subtree against the guest-link one
              // below by position, reusing DOM checkbox nodes across modes
              // and leaking their live `checked` state (e.g. "Listen"
              // defaults checked for an invite but not a guest link).
              <div key="invite">
                <label className="form-group">
                  <span className="form-label">Email</span>
                  <input
                    className="input-field"
                    name="email"
                    required
                    type="email"
                    maxLength={320}
                    autoFocus
                  />
                </label>
                <label className="form-group">
                  <span className="form-label">Access level</span>
                  <select
                    className="input-field"
                    name="role"
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(
                        event.target.value as 'admin' | 'viewer' | 'guest',
                      )
                    }
                  >
                    {canInviteAdmin && <option value="admin">Admin</option>}
                    <option value="viewer">Viewer</option>
                    <option value="guest">Guest</option>
                  </select>
                </label>
                {inviteRole === 'guest' && (
                  <label className="form-group">
                    <span className="form-label">Expires after</span>
                    <select
                      className="input-field"
                      name="expiresInHours"
                      defaultValue="24"
                    >
                      <option value="1">1 hour</option>
                      <option value="24">24 hours</option>
                      <option value="72">3 days</option>
                      <option value="168">7 days</option>
                    </select>
                  </label>
                )}
                {inviteRole === 'viewer' && (
                  <div className="form-group">
                    <span className="form-label">Default camera access</span>
                    <div className="permission-pills">
                      <label className="sharing-permission-toggle">
                        <input
                          defaultChecked
                          name="defaultCanListen"
                          type="checkbox"
                        />
                        Listen
                      </label>
                      <label className="sharing-permission-toggle">
                        <input name="defaultCanTalk" type="checkbox" />
                        Talk
                      </label>
                      <label className="sharing-permission-toggle">
                        <input name="defaultCanFlip" type="checkbox" />
                        Flip
                      </label>
                      <label className="sharing-permission-toggle">
                        <input name="defaultCanPause" type="checkbox" />
                        Pause
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div key="guestLink">
                <label className="form-group">
                  <span className="form-label">Label (optional)</span>
                  <input
                    className="input-field"
                    name="label"
                    maxLength={100}
                    placeholder="e.g. Grandma"
                    autoFocus
                  />
                </label>
                <label className="form-group">
                  <span className="form-label">Expires after</span>
                  <select
                    className="input-field"
                    name="expiresInHours"
                    defaultValue="24"
                  >
                    <option value="1">1 hour</option>
                    <option value="24">24 hours</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                  </select>
                </label>
                <div className="form-group">
                  <span className="form-label">Cameras</span>
                  <div className="permission-pills">
                    {cameras.map((camera) => (
                      <label
                        key={camera.id}
                        className="sharing-permission-toggle"
                      >
                        <input
                          name="cameraIds"
                          type="checkbox"
                          value={camera.id}
                        />
                        {camera.deviceName || camera.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <span className="form-label">Access</span>
                  <div className="permission-pills">
                    <label className="sharing-permission-toggle">
                      <input name="canListen" type="checkbox" />
                      Listen
                    </label>
                    <label className="sharing-permission-toggle">
                      <input name="canTalk" type="checkbox" />
                      Talk
                    </label>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="settings-card-inline-message">
                {error}
              </p>
            )}
            <div className="confirm-modal-actions">
              <button type="button" className="secondary" onClick={onDismiss}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy
                  ? 'Sending…'
                  : mode === 'invite'
                    ? 'Send invitation'
                    : 'Create guest link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalDialog>
  );
}

type GrantPrefs = Pick<
  CameraGrant,
  'canListen' | 'canTalk' | 'canFlip' | 'canPause'
>;

const CAMERAS_REVEAL_INITIAL = 8;
const CAMERAS_REVEAL_STEP = 8;

function ManageMemberDialog({
  member,
  cameras,
  onSave,
  onRevoke,
  onRemove,
  onDismiss,
}: {
  member: Member;
  cameras: Camera[];
  onSave: (grants: CameraGrant[]) => Promise<void>;
  onRevoke?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  onDismiss: () => void;
}) {
  const [grants, setGrants] = useState(
    Object.fromEntries(member.grants.map((grant) => [grant.cameraId, grant])),
  );
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(CAMERAS_REVEAL_INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lastKnownPrefs = useRef<Record<string, GrantPrefs>>(
    Object.fromEntries(
      member.grants.map((grant) => [
        grant.cameraId,
        {
          canListen: grant.canListen,
          canTalk: grant.canTalk,
          canFlip: grant.canFlip,
          canPause: grant.canPause,
        },
      ]),
    ),
  );

  function toggleView(camera: Camera, checked: boolean) {
    setGrants((current) => {
      const next = { ...current };
      if (checked) {
        const remembered = lastKnownPrefs.current[camera.id];
        next[camera.id] = {
          cameraId: camera.id,
          cameraName: camera.name,
          canListen: remembered?.canListen ?? false,
          canTalk: remembered?.canTalk ?? false,
          canFlip: remembered?.canFlip ?? false,
          canPause: remembered?.canPause ?? false,
        };
      } else {
        const existing = next[camera.id];
        if (existing) {
          lastKnownPrefs.current[camera.id] = {
            canListen: existing.canListen,
            canTalk: existing.canTalk,
            canFlip: existing.canFlip,
            canPause: existing.canPause,
          };
        }
        delete next[camera.id];
      }
      return next;
    });
  }

  function togglePermission(cameraId: string, key: keyof GrantPrefs) {
    setGrants((current) => ({
      ...current,
      [cameraId]: {
        ...(current[cameraId] || {
          cameraId,
          cameraName: '',
          canListen: false,
          canTalk: false,
          canFlip: false,
          canPause: false,
        }),
        [key]: !(current[cameraId] ? current[cameraId][key] : false),
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(Object.values(grants));
      onDismiss();
    } catch (caught) {
      setError(
        friendlyError(caught, 'Camera access couldn’t be saved. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  }

  const filtered = search.trim()
    ? cameras.filter((camera) =>
        `${camera.deviceName} ${camera.name}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : cameras;
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;
  const grantedCount = Object.keys(grants).length;

  return (
    <ModalDialog labelledBy="manage-member-title" onDismiss={onDismiss}>
      <div className="favorites-editor manage-member-dialog">
        <div className="favorites-editor-header">
          <div>
            <h2 id="manage-member-title">{member.email}</h2>
            <p>
              {member.role[0]!.toUpperCase()}
              {member.role.slice(1)} · {grantedCount} camera
              {grantedCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>

        {cameras.length > 8 && (
          <input
            className="input-field manage-member-search"
            type="search"
            placeholder="Find a camera"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleCount(CAMERAS_REVEAL_INITIAL);
            }}
            aria-label="Find a camera"
          />
        )}

        <div className="manage-member-cameras">
          {visible.map((camera) => {
            const grant = grants[camera.id];
            const name = camera.deviceName || camera.name;
            return (
              <fieldset key={camera.id} className="sharing-grants-fieldset">
                <legend>{name}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(grant)}
                    onChange={(event) =>
                      toggleView(camera, event.target.checked)
                    }
                  />
                  View
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grant?.canListen ?? false}
                    disabled={!grant}
                    onChange={() => togglePermission(camera.id, 'canListen')}
                  />
                  Listen
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grant?.canTalk ?? false}
                    disabled={!grant}
                    onChange={() => togglePermission(camera.id, 'canTalk')}
                  />
                  Talk
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grant?.canFlip ?? false}
                    disabled={!grant}
                    onChange={() => togglePermission(camera.id, 'canFlip')}
                  />
                  Flip
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={grant?.canPause ?? false}
                    disabled={!grant}
                    onChange={() => togglePermission(camera.id, 'canPause')}
                  />
                  Pause
                </label>
              </fieldset>
            );
          })}
          {filtered.length === 0 && (
            <p className="settings-card-empty">No cameras match.</p>
          )}
        </div>

        {remaining > 0 && (
          <div className="notification-reveal">
            <span>
              {visible.length} of {filtered.length} cameras
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(filtered.length, count + CAMERAS_REVEAL_STEP),
                )
              }
            >
              Load more cameras
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="settings-card-inline-message">
            {error}
          </p>
        )}

        <div className="manage-member-footer">
          <div className="manage-member-danger">
            {onRevoke && (
              <button
                type="button"
                className="quiet-button quiet-button-danger"
                onClick={onRevoke}
              >
                Remove access
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="quiet-button quiet-button-danger"
                onClick={onRemove}
              >
                Delete from list
              </button>
            )}
          </div>
          <div className="confirm-modal-actions">
            <button type="button" className="secondary" onClick={onDismiss}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
