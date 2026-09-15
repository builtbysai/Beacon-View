import { useState, type FormEvent } from 'react';
import { request } from './api';
import { Brand, Icon } from './Icon';

function PasswordResetRequest() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email =
      (new FormData(event.currentTarget).get('email') as string | null) ?? '';
    setBusy(true);
    try {
      await request<void>('/api/auth/password-reset/request', {
        body: JSON.stringify({ email }),
        method: 'POST',
      });
    } catch {
      // Deliberately silent: the response never reveals whether the
      // request failed because the endpoint is unavailable or because
      // nothing went wrong at all -- either way the message below is
      // the same, so the account's existence is never distinguishable.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent)
    return (
      <p className="recovery-note" role="status">
        If an account exists for that email, check your inbox for a reset link.
      </p>
    );

  return (
    <form
      className="recovery-note recovery-form"
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Request a password reset"
    >
      <label className="visually-hidden" htmlFor="recovery-email">
        Email
      </label>
      <input
        id="recovery-email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Enter your account email"
        required
        disabled={busy}
      />
      <button className="secondary" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}

export function AuthScreen({
  mode,
  busy,
  error,
  onSubmit,
  onMode,
}: {
  mode: 'login' | 'register';
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMode: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const googleResult = new URLSearchParams(window.location.search).get(
    'googleSignIn',
  );
  return (
    <main className="auth-landing">
      <section className="auth-hero" aria-labelledby="landing-title">
        <a className="auth-hero-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <div className="auth-hero-copy">
          <p className="eyebrow">Your space, within reach</p>
          <h1 id="landing-title">
            Your cameras,
            <br />
            <em>always within reach.</em>
          </h1>
          <p>
            Turn a spare device into a private camera and check it securely from
            any modern browser.
          </p>
          <div className="auth-hero-preview" aria-hidden="true">
            <span className="hero-phone">
              <Icon name="phone" />
              Camera
            </span>
            <span className="hero-connection">
              <Icon name="lock" />
            </span>
            <span className="hero-browser">
              <Icon name="browser" />
              Live view
            </span>
          </div>
        </div>
        <div className="auth-hero-footer">
          <span>
            <Icon name="shield" /> Visible capture
          </span>
          <span>
            <Icon name="lock" /> Private access
          </span>
          <span>
            <Icon name="eyeOff" /> No cloud recordings
          </span>
          <a href="/trust">Trust &amp; privacy</a>
        </div>
      </section>

      <section className="card sign-in-card" aria-labelledby="sign-in-title">
        <header className="sign-in-brand">
          <span className="auth-home-mark" aria-hidden="true">
            <Icon name="home" />
          </span>
          <Brand />
        </header>
        <p className="eyebrow">Your space, within reach</p>
        <h2 id="sign-in-title">
          {mode === 'login' ? 'Welcome to Beacon' : 'Create your account'}
        </h2>
        <p className="sign-in-intro">
          {mode === 'login'
            ? 'Sign in to access your cameras and live views.'
            : 'One account keeps every camera in reach.'}
        </p>
        <p className="sign-in-trust-strap">
          <Icon name="shield" />
          Private by design. No cloud recordings.
        </p>
        <a className="google-sign-in" href="/api/auth/google">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
            />
          </svg>
          <span>Continue with Google</span>
          <Icon name="arrow" />
        </a>
        {googleResult === 'linkRequired' && (
          <p role="alert">
            This email already has a Beacon password account. Sign in below,
            then link Google from Settings to use either method.
          </p>
        )}
        {googleResult === 'failed' && (
          <p role="alert">Google sign-in could not be completed. Try again.</p>
        )}
        <div className="sign-in-divider">or</div>
        <form
          onSubmit={onSubmit}
          aria-label={
            mode === 'login' ? 'Password sign in' : 'Create password account'
          }
        >
          <p className="password-form-label">
            {mode === 'login'
              ? 'Sign in with your Beacon account'
              : 'Create a password account'}
          </p>
          <label htmlFor="beacon-email">Email</label>
          <input
            id="beacon-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Enter your email"
            required
            disabled={busy}
          />
          <label htmlFor="beacon-password">Password</label>
          <div className="sign-in-password">
            <input
              id="beacon-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              placeholder="Enter your password"
              minLength={12}
              required
              disabled={busy}
              aria-describedby={
                mode === 'register' ? 'password-guidance' : undefined
              }
            />
            <button
              className="secondary"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="beacon-password"
              onClick={() => setShowPassword(!showPassword)}
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} />
            </button>
          </div>
          {mode === 'register' && (
            <p className="notice" id="password-guidance">
              Use at least 12 characters.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="password-submit" type="submit" disabled={busy}>
            {busy
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
          <div className="sign-in-links">
            {mode === 'login' && (
              <button
                className="link"
                type="button"
                aria-expanded={showRecovery}
                onClick={() => setShowRecovery(!showRecovery)}
              >
                Forgot password?
              </button>
            )}
            <button
              className="link create-account-link"
              type="button"
              disabled={busy}
              onClick={() => {
                setShowPassword(false);
                setShowRecovery(false);
                onMode();
              }}
            >
              {mode === 'login'
                ? 'Create a password account'
                : 'Use an existing account'}
            </button>
          </div>
          {showRecovery && <PasswordResetRequest />}
        </form>
        <p className="sign-in-disclosure">
          <Icon name="shield" />
          Camera and microphone capture stays visible on the camera device.
        </p>
      </section>
    </main>
  );
}
