import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { request } from './api';
import type { Camera, HouseholdRole } from './domain';

interface CameraGrant {
  cameraId: string;
  cameraName: string;
  canListen: boolean;
  canTalk: boolean;
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

export function HouseholdSharingSettings({
  cameras,
  role,
}: {
  cameras: Camera[];
  role: HouseholdRole;
}) {
  const canManage = role === 'owner' || role === 'admin';
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [createdInvite, setCreatedInvite] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!canManage) return;
    const result = await request<SharingState>('/api/household/sharing');
    setSharing(result);
  }, [canManage]);

  useEffect(() => {
    void load().catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : 'Unable to load sharing',
      ),
    );
  }, [load]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const roleValue = data.get('role');
    const invitedRole =
      roleValue === 'admin' || roleValue === 'guest' ? roleValue : 'viewer';
    setBusy(true);
    setError('');
    setMessage('');
    setCreatedInvite(null);
    try {
      const result = await request<{ expiresAt: string; token: string }>(
        '/api/household/invitations',
        {
          body: JSON.stringify({
            email: data.get('email'),
            role: invitedRole,
            ...(invitedRole === 'guest'
              ? { expiresInHours: Number(data.get('expiresInHours')) }
              : {}),
          }),
          method: 'POST',
        },
      );
      setCreatedInvite({ code: result.token, expiresAt: result.expiresAt });
      setMessage(
        'Invitation created. Share this code through a trusted channel.',
      );
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to create invitation',
      );
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !inviteCode.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const accepted = await request<{ householdId: string }>(
        '/api/household/invitations/accept',
        {
          body: JSON.stringify({ token: inviteCode.trim() }),
          method: 'POST',
        },
      );
      await request('/api/account/household', {
        body: JSON.stringify({ householdId: accepted.householdId }),
        method: 'PUT',
      });
      window.location.assign('/');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to accept invitation',
      );
      setBusy(false);
    }
  }

  async function resendInvitation(invitation: Invitation) {
    setBusy(true);
    setError('');
    setMessage('');
    setCreatedInvite(null);
    try {
      const result = await request<{ expiresAt: string; token: string }>(
        `/api/household/invitations/${invitation.id}/resend`,
        { method: 'POST' },
      );
      setCreatedInvite({ code: result.token, expiresAt: result.expiresAt });
      setMessage(
        `New invitation created for ${invitation.invitedEmail}. Share this code through a trusted channel.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to resend invitation',
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
        caught instanceof Error
          ? caught.message
          : 'Unable to revoke invitation',
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
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to revoke access',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyCreatedInvitation() {
    if (!createdInvite || !navigator.clipboard) {
      setError('Clipboard access is unavailable. Select and copy the code.');
      return;
    }
    try {
      await navigator.clipboard.writeText(createdInvite.code);
      setError('');
      setMessage('Invitation code copied.');
    } catch {
      setError('Could not copy the invitation code. Select and copy it.');
    }
  }

  return (
    <div className="sharing-settings">
      <form
        className="sharing-accept"
        onSubmit={(event) => void acceptInvitation(event)}
      >
        <div>
          <strong>Join another household</strong>
          <p>Paste the one-time code sent to your account email.</p>
        </div>
        <label>
          Invitation code
          <input
            autoComplete="off"
            maxLength={512}
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
          />
        </label>
        <button disabled={busy || !inviteCode.trim()} type="submit">
          Accept invitation
        </button>
      </form>

      {canManage && (
        <>
          <form
            className="sharing-invite"
            onSubmit={(event) => void createInvitation(event)}
          >
            <div>
              <strong>Invite someone</strong>
              <p>Codes expire and work only for the exact invited email.</p>
            </div>
            <label>
              Email
              <input name="email" required type="email" maxLength={320} />
            </label>
            <label>
              Access level
              <select name="role" defaultValue="viewer">
                {role === 'owner' && <option value="admin">Admin</option>}
                <option value="viewer">Viewer</option>
                <option value="guest">Guest</option>
              </select>
            </label>
            <label>
              Guest duration
              <select name="expiresInHours" defaultValue="24">
                <option value="1">1 hour</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <button disabled={busy} type="submit">
              Create invitation
            </button>
          </form>

          {createdInvite && (
            <div className="sharing-code" role="status">
              <div>
                <strong>Copy this code now</strong>
                <p>
                  Beacon stores only its hash. It expires{' '}
                  {new Date(createdInvite.expiresAt).toLocaleString()}.
                </p>
              </div>
              <code>{createdInvite.code}</code>
              <button
                className="secondary"
                type="button"
                onClick={() => void copyCreatedInvitation()}
              >
                Copy code
              </button>
            </div>
          )}

          <div className="sharing-list" aria-label="Household members">
            <h4>Members</h4>
            {sharing?.members.map((member) => (
              <MemberRow
                key={member.id}
                actorRole={role}
                busy={busy}
                cameras={cameras}
                member={member}
                onChanged={load}
                onError={setError}
                onRevoke={() => revokeMember(member)}
              />
            ))}
            {sharing?.members.length === 0 && <p>No household members.</p>}
          </div>

          {sharing && sharing.invitations.length > 0 && (
            <div className="sharing-list" aria-label="Pending invitations">
              <h4>Pending invitations</h4>
              {sharing.invitations.map((invitation) => (
                <div className="sharing-person" key={invitation.id}>
                  <div>
                    <strong>{invitation.invitedEmail}</strong>
                    <p>
                      {invitation.role} · expires{' '}
                      {new Date(invitation.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  {(role === 'owner' || invitation.role !== 'admin') && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void resendInvitation(invitation)}
                        type="button"
                      >
                        Resend invitation
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => void revokeInvitation(invitation)}
                        type="button"
                      >
                        Revoke invitation
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function MemberRow({
  actorRole,
  busy,
  cameras,
  member,
  onChanged,
  onError,
  onRevoke,
}: {
  actorRole: HouseholdRole;
  busy: boolean;
  cameras: Camera[];
  member: Member;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onRevoke: () => Promise<void>;
}) {
  const [grants, setGrants] = useState(
    Object.fromEntries(member.grants.map((grant) => [grant.cameraId, grant])),
  );
  const [saving, setSaving] = useState(false);
  // `member` is replaced wholesale after `onChanged()` reloads the household
  // from the server (e.g. after this row's own save, or another admin's
  // change). Without resyncing here, local checkbox state would keep
  // reflecting whatever was on screen before that reload instead of the
  // now-confirmed server state.
  useEffect(() => {
    setGrants(
      Object.fromEntries(member.grants.map((grant) => [grant.cameraId, grant])),
    );
  }, [member]);
  // Unchecking "View" removes the whole grant entry (including its
  // canListen/canTalk), so remember the last values per camera locally and
  // restore them on re-check instead of silently resetting to off — the
  // admin shouldn't have to re-configure Listen/Talk just from a stray
  // View toggle within the same edit session.
  const lastKnownPrefs = useRef<
    Record<string, { canListen: boolean; canTalk: boolean }>
  >(
    Object.fromEntries(
      member.grants.map((grant) => [
        grant.cameraId,
        { canListen: grant.canListen, canTalk: grant.canTalk },
      ]),
    ),
  );
  const editable =
    member.status === 'active' &&
    (member.role === 'viewer' || member.role === 'guest');
  const revocable =
    member.status === 'active' &&
    member.role !== 'owner' &&
    (actorRole === 'owner' || member.role !== 'admin');

  async function save() {
    setSaving(true);
    onError('');
    try {
      await request(`/api/household/members/${member.id}/grants`, {
        body: JSON.stringify({
          grants: Object.values(grants).map((grant) => ({
            cameraId: grant.cameraId,
            canListen: grant.canListen,
            canTalk: grant.canTalk,
          })),
        }),
        method: 'PUT',
      });
      await onChanged();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : 'Unable to save camera access',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sharing-person">
      <div>
        <strong>{member.email}</strong>
        <p>
          {member.role} · {member.status}
          {member.expiresAt
            ? ` until ${new Date(member.expiresAt).toLocaleString()}`
            : ''}
        </p>
      </div>
      {editable && (
        <div className="sharing-grants">
          {cameras.map((camera) => {
            const grant = grants[camera.id];
            return (
              <fieldset key={camera.id}>
                <legend>{camera.deviceName || camera.name}</legend>
                <label>
                  <input
                    checked={Boolean(grant)}
                    type="checkbox"
                    onChange={(event) =>
                      setGrants((current) => {
                        const next = { ...current };
                        if (event.target.checked) {
                          const remembered = lastKnownPrefs.current[camera.id];
                          next[camera.id] = {
                            cameraId: camera.id,
                            cameraName: camera.name,
                            canListen: remembered?.canListen ?? false,
                            canTalk: remembered?.canTalk ?? false,
                          };
                        } else {
                          const existing = next[camera.id];
                          if (existing) {
                            lastKnownPrefs.current[camera.id] = {
                              canListen: existing.canListen,
                              canTalk: existing.canTalk,
                            };
                          }
                          delete next[camera.id];
                        }
                        return next;
                      })
                    }
                  />
                  View
                </label>
                <label>
                  <input
                    checked={grant?.canListen ?? false}
                    disabled={!grant}
                    type="checkbox"
                    onChange={(event) =>
                      setGrants((current) => ({
                        ...current,
                        [camera.id]: {
                          ...current[camera.id]!,
                          canListen: event.target.checked,
                        },
                      }))
                    }
                  />
                  Listen
                </label>
                <label>
                  <input
                    checked={grant?.canTalk ?? false}
                    disabled={!grant}
                    type="checkbox"
                    onChange={(event) =>
                      setGrants((current) => ({
                        ...current,
                        [camera.id]: {
                          ...current[camera.id]!,
                          canTalk: event.target.checked,
                        },
                      }))
                    }
                  />
                  Talk
                </label>
              </fieldset>
            );
          })}
          <button
            disabled={busy || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? 'Saving…' : 'Save camera access'}
          </button>
        </div>
      )}
      {revocable && (
        <button
          className="danger"
          disabled={busy}
          onClick={() => void onRevoke()}
          type="button"
        >
          Remove access
        </button>
      )}
    </div>
  );
}
