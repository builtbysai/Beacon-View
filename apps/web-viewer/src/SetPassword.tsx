import { useEffect, useState, type FormEvent } from 'react';

import { ApiError, request } from './api';
import { SettingsFieldRow, SettingsField, SettingsRow } from './SettingsUI';

export function SetPassword({ onSet }: { onSet: () => void }) {
  const [open, setOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get('addPassword') === '1',
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (!parameters.has('addPassword')) return;
    parameters.delete('addPassword');
    const search = parameters.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}`,
    );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password !== confirmPassword) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/account/password/set', {
        body: JSON.stringify({ password }),
        method: 'POST',
      });
      setPassword('');
      setConfirmPassword('');
      setOpen(false);
      onSet();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Unable to set password',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <SettingsRow
        title="Add a password"
        description="Sign in with either your password or Google afterward."
      >
        <button className="secondary" onClick={() => setOpen(true)}>
          Add password
        </button>
      </SettingsRow>
    );
  }

  return (
    <div className="settings-row">
      <form
        aria-label="Add a password"
        onSubmit={(event) => void submit(event)}
      >
        <SettingsFieldRow
          label="Add a password"
          description="Use at least 12 characters. Sign in with either method afterward."
        >
          <SettingsField label="New password" htmlFor="set-password" wide>
            <input
              id="set-password"
              autoComplete="new-password"
              disabled={busy}
              minLength={12}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </SettingsField>
          <SettingsField
            label="Confirm password"
            htmlFor="set-password-confirm"
            wide
          >
            <input
              id="set-password-confirm"
              autoComplete="new-password"
              aria-invalid={mismatch}
              disabled={busy}
              minLength={12}
              required
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </SettingsField>
          <button disabled={busy || password !== confirmPassword} type="submit">
            {busy ? 'Saving…' : 'Save password'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            type="button"
            onClick={() => {
              setOpen(false);
              setPassword('');
              setConfirmPassword('');
              setError('');
            }}
          >
            Cancel
          </button>
        </SettingsFieldRow>
        {mismatch && <p role="alert">Passwords don't match.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
  );
}
