import { useEffect, useState } from 'react';
import { request } from './api';
import { Brand } from './Icon';

export function VerifyEmailPage() {
  const [state, setState] = useState<'pending' | 'confirmed' | 'failed'>(
    'pending',
  );

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('failed');
      return;
    }
    let active = true;
    void request<void>('/api/account/email/verify/confirm', {
      body: JSON.stringify({ token }),
      method: 'POST',
    })
      .then(() => {
        if (active) setState('confirmed');
      })
      .catch(() => {
        if (active) setState('failed');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="verify-email-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Account</p>
        <h1 id="verify-email-title">
          {state === 'pending' && 'Verifying your email…'}
          {state === 'confirmed' && 'Email verified.'}
          {state === 'failed' && 'That link is no longer valid.'}
        </h1>
        <p className="trust-lead" role="status">
          {state === 'pending' && 'One moment while we confirm your address.'}
          {state === 'confirmed' &&
            'This address can now be used to recover your account.'}
          {state === 'failed' &&
            'Verification links expire after 24 hours and can only be used once. Request a new one from Settings.'}
        </p>
        <a className="secondary button-link" href="/settings">
          Go to Settings
        </a>
      </section>
    </main>
  );
}
