import { useState, type FormEvent } from 'react';
import { ApiError, request } from './api';
import { Brand } from './Icon';

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const data = new FormData(event.currentTarget);
    const password = (data.get('password') as string | null) ?? '';
    const confirmation = (data.get('confirmation') as string | null) ?? '';
    if (password !== confirmation) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request<void>('/api/auth/password-reset/confirm', {
        body: JSON.stringify({ password, token }),
        method: 'POST',
      });
      setDone(true);
    } catch (thrown) {
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'The password could not be reset. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="trust-shell">
      <section className="trust-page" aria-labelledby="reset-password-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Account</p>
        {!token ? (
          <>
            <h1 id="reset-password-title">That link is no longer valid.</h1>
            <p className="trust-lead">
              Password reset links expire after one hour and can only be used
              once. Request a new one from the sign-in page.
            </p>
            <a className="btn-secondary w-full" href="/">
              Return to Beacon
            </a>
          </>
        ) : done ? (
          <>
            <h1 id="reset-password-title">Password updated.</h1>
            <p className="trust-lead">
              Every other browser session was signed out. Sign in again with
              your new password.
            </p>
            <a className="btn-secondary w-full" href="/">
              Sign in
            </a>
          </>
        ) : (
          <>
            <h1 id="reset-password-title">Choose a new password.</h1>
            <form onSubmit={(event) => void onSubmit(event)} className="flex-col gap-4">
              <div className="form-group">
                <label className="form-label" htmlFor="reset-password">New password</label>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter a new password"
                  minLength={12}
                  required
                  disabled={busy}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reset-password-confirm">Confirm password</label>
                <input
                  id="reset-password-confirm"
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter the new password"
                  minLength={12}
                  required
                  disabled={busy}
                  className="input-field"
                />
              </div>
              {error && <p className="auth-alert" role="alert">{error}</p>}
              <button className="btn-primary w-full mt-4" type="submit" disabled={busy}>
                {busy ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
