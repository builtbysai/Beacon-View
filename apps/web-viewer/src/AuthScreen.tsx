import { useState, useEffect, type FormEvent } from 'react';
import { request } from './api';
import { Icon } from './Icon';
import { PublicHeader } from './PublicHeader';
import './AuthScreen.css';

export function AuthScreen({
  mode: initialMode,
  busy,
  error,
  googleAvailable = true,
  onSubmit,
  onMode,
}: {
  mode: 'login' | 'register';
  busy: boolean;
  error: string;
  googleAvailable?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMode: () => void;
}) {
  const [view, setView] = useState<'login' | 'register' | 'forgot-password'>(
    initialMode,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const googleResult = new URLSearchParams(window.location.search).get(
    'googleSignIn',
  );

  const confirmMismatch =
    view === 'register' &&
    confirmPassword.length > 0 &&
    confirmPassword !== password;
  const isBusy = busy || localBusy;

  useEffect(() => {
    setView(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setShowPassword(false);
    setPassword('');
    setConfirmPassword('');
    setResetSent(false);
  }, [view]);

  async function onResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    const email =
      (new FormData(event.currentTarget).get('email') as string | null) ?? '';
    setLocalBusy(true);
    try {
      await request<void>('/api/auth/password-reset/request', {
        body: JSON.stringify({ email }),
        method: 'POST',
      });
    } catch {
      // The response is intentionally identical whether the account exists.
    } finally {
      setLocalBusy(false);
      setResetSent(true);
    }
  }

  const googleHref =
    view === 'register'
      ? '/api/auth/google?intent=addPassword'
      : '/api/auth/google';

  const onBack = () => {
    window.history.back();
  };

  const authAction = (
    <button onClick={onBack} className="ph-back-action">
      &larr; Back to Beacon
    </button>
  );

  return (
    <>
      <PublicHeader action={authAction} sticky={false} alignContainer="auth" />
      <main className="auth">
        <section className="stage">
          <aside className="context">
            <p className="eyebrow">Welcome back</p>
            <h1>See what matters, from wherever you are.</h1>
            <p>
              Sign in to view your cameras and manage the devices connected to
              Beacon.
            </p>
            <div className="context-note">
              <Icon name="check" />
              Live viewing · Private access · Optional encrypted clips
            </div>
          </aside>

          <section className="card" aria-live="polite">
            {googleResult === 'linkRequired' && view !== 'forgot-password' && (
              <div className="auth-alert auth-info-block" role="alert">
                Google sign-in succeeded, but you need to sign in with your
                password first to link the account. Once you do, we'll link your
                Google account automatically.
              </div>
            )}

            {googleResult === 'failed' && view !== 'forgot-password' && (
              <div className="auth-alert auth-error-block" role="alert">
                Google sign-in could not be completed. Please try again.
              </div>
            )}

            {error && view !== 'forgot-password' && (
              <div className="auth-alert auth-error-block" role="alert">
                {error}
              </div>
            )}

            {view === 'login' && (
              <div className="view active" id="signin">
                <div className="card-head">
                  <h2>Sign in</h2>
                  <p>Continue to your Beacon cameras.</p>
                </div>
                <form aria-label="Password sign in" onSubmit={onSubmit}>
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="email">Email</label>
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={isBusy}
                    />
                  </div>
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="password">Password</label>
                      <button
                        type="button"
                        className="textlink"
                        onClick={() => setView('forgot-password')}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="password">
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isBusy}
                      />
                      <button
                        className="eye"
                        type="button"
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                      </button>
                    </div>
                  </div>
                  <button className="primary" disabled={isBusy}>
                    {isBusy ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
                <div className="divider">or</div>
                {googleAvailable ? (
                  <a className="google" href={googleHref}>
                    <span className="g">G</span>Continue with Google
                  </a>
                ) : (
                  <span className="google" aria-disabled="true">
                    <span className="g">G</span>Google sign-in unavailable
                  </span>
                )}
                <p className="switch">
                  New to Beacon?{' '}
                  <button
                    onClick={() => {
                      setView('register');
                      onMode();
                    }}
                  >
                    Create an account
                  </button>
                </p>
                <p className="switch">
                  <a href="/camera-mode/setup">Use this browser as a camera</a>
                </p>
              </div>
            )}

            {view === 'register' && (
              <div className="view active" id="create">
                <div className="card-head">
                  <h2>Create your account</h2>
                  <p>Set up Beacon in a few moments.</p>
                </div>
                <form
                  aria-label="Create an account"
                  onSubmit={(e) => {
                    if (password !== confirmPassword) {
                      e.preventDefault();
                      return;
                    }
                    onSubmit(e);
                  }}
                >
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="newemail">Email</label>
                    </div>
                    <input
                      id="newemail"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={isBusy}
                    />
                  </div>
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="newpass">Password</label>
                    </div>
                    <div className="password">
                      <input
                        id="newpass"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isBusy}
                      />
                      <button
                        className="eye"
                        type="button"
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                      </button>
                    </div>
                  </div>
                  <p className="helper">Use at least 12 characters.</p>
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="confirm">Confirm password</label>
                    </div>
                    <input
                      id="confirm"
                      name="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      aria-invalid={confirmMismatch}
                      disabled={isBusy}
                    />
                    {confirmMismatch && (
                      <p
                        className="helper"
                        style={{ color: 'var(--danger)', marginTop: '4px' }}
                      >
                        Passwords don't match.
                      </p>
                    )}
                  </div>
                  <button
                    className="primary"
                    disabled={isBusy || confirmMismatch}
                  >
                    {isBusy ? 'Creating account…' : 'Create account'}
                  </button>
                </form>
                <div className="divider">or</div>
                {googleAvailable ? (
                  <a className="google" href={googleHref}>
                    <span className="g">G</span>Continue with Google
                  </a>
                ) : (
                  <span className="google" aria-disabled="true">
                    <span className="g">G</span>Google sign-in unavailable
                  </span>
                )}
                <p className="switch">
                  Already have an account?{' '}
                  <button
                    onClick={() => {
                      setView('login');
                      onMode();
                    }}
                  >
                    Sign in
                  </button>
                </p>
              </div>
            )}

            {view === 'forgot-password' && !resetSent && (
              <div className="view active" id="forgot">
                <div className="card-head">
                  <h2>Reset your password</h2>
                  <p>Enter your email and we'll send you a reset link.</p>
                </div>
                <form
                  aria-label="Request a password reset"
                  onSubmit={(event) => void onResetSubmit(event)}
                >
                  <div className="field">
                    <div className="labelrow">
                      <label htmlFor="resetemail">Email</label>
                    </div>
                    <input
                      id="resetemail"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={isBusy}
                    />
                  </div>
                  <button className="primary" disabled={isBusy}>
                    {isBusy ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>
                <p className="switch">
                  <button onClick={() => setView('login')}>
                    ← Back to sign in
                  </button>
                </p>
              </div>
            )}

            {view === 'forgot-password' && resetSent && (
              <div className="view active" id="sent">
                <div className="success">✓</div>
                <div className="card-head">
                  <h2>Check your email</h2>
                  <p>
                    If an account exists for that address, you'll receive a
                    password reset link shortly.
                  </p>
                </div>
                <button className="primary" onClick={() => setView('login')}>
                  Back to sign in
                </button>
              </div>
            )}
          </section>
        </section>

        <footer className="foot">
          <span>Beacon · Private alpha</span>
          <div className="footlinks">
            <a href="/trust">Trust & privacy</a>
            <a href="/contact">Contact</a>
          </div>
        </footer>
      </main>
    </>
  );
}
