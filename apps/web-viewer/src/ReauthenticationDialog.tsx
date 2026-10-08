import { useState, type FormEvent } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { ModalDialog } from './ModalDialog';

export function ReauthenticationDialog({
  onCancel,
  onConfirmed,
}: {
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const password =
      (new FormData(event.currentTarget).get('password') as string | null) ??
      '';
    setBusy(true);
    setError('');
    try {
      await request<void>('/api/account/reauth', {
        body: JSON.stringify({ password }),
        method: 'POST',
      });
      onConfirmed();
    } catch (caught) {
      setError(
        friendlyError(
          caught,
          'Your password couldn’t be confirmed. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog labelledBy="reauthentication-title" onDismiss={onCancel}>
      <section
        className="confirm-modal"
        aria-labelledby="reauthentication-title"
      >
        <div className="confirm-modal-header">
          <h2 id="reauthentication-title">Confirm it’s you</h2>
        </div>
        <div className="confirm-modal-body">
          <p>Enter your password to continue with account deletion.</p>
          {error && <p role="alert">{error}</p>}
        </div>
        <form
          className="reauthentication-form"
          onSubmit={(event) => void submit(event)}
        >
          <label className="form-label" htmlFor="reauthentication-password">
            Password
          </label>
          <input
            autoComplete="current-password"
            disabled={busy}
            id="reauthentication-password"
            name="password"
            required
            type="password"
          />
          <div className="heading-actions confirm-modal-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button className="btn danger" disabled={busy} type="submit">
              {busy ? 'Confirming…' : 'Continue'}
            </button>
          </div>
        </form>
      </section>
    </ModalDialog>
  );
}
