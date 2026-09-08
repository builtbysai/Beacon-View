import { useState, type FormEvent } from 'react';
import { Brand, Icon } from './Icon';

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
  const googleResult = new URLSearchParams(window.location.search).get(
    'googleSignIn',
  );
  return (
    <main className="sign-in-layout">
      <section className="card sign-in-card" aria-labelledby="sign-in-title">
        <header className="sign-in-brand">
          <Brand />
          <span className="alpha-badge">Private alpha</span>
        </header>
        <p className="eyebrow">Your space, within reach</p>
        <h1 id="sign-in-title">Welcome to Beacon</h1>
        <p className="sign-in-intro">
          One account for your cameras and live views.
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
            This email already has a Beacon password account. Use your existing
            password below. Google account linking is not yet available.
          </p>
        )}
        {googleResult === 'failed' && (
          <p role="alert">Google sign-in could not be completed. Try again.</p>
        )}
        <div className="sign-in-divider">or use a Beacon password</div>
        <form
          onSubmit={onSubmit}
          aria-label={
            mode === 'login' ? 'Password sign in' : 'Create password account'
          }
        >
          <label htmlFor="beacon-email">Email</label>
          <input
            id="beacon-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
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
              Use at least 12 characters. Password-reset emails are not
              available yet; Google is recommended for new accounts.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            className="secondary password-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
          <div className="sign-in-links">
            <button
              className="link"
              type="button"
              disabled={busy}
              onClick={() => {
                setShowPassword(false);
                onMode();
              }}
            >
              {mode === 'login'
                ? 'Create a password account'
                : 'Use an existing account'}
            </button>
            <a href="/trust">Trust and privacy</a>
          </div>
        </form>
        <p className="sign-in-disclosure">
          <Icon name="shield" />
          Camera and microphone capture stay visible on your Android device.
        </p>
      </section>
    </main>
  );
}
