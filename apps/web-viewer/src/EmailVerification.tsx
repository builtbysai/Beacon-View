import { useState } from 'react';
import { request } from './api';

export function EmailVerification({ verified }: { verified: boolean }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await request<void>('/api/account/email/verify/request', {
        method: 'POST',
      });
      setSent(true);
    } catch {
      setError('The verification email could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  }

  if (verified) {
    return (
      <div className="settings-row">
        <div>
          <strong>Email verified</strong>
          <p>This address can be used to recover your account.</p>
        </div>
        <span className="status-badge status-online">Verified</span>
      </div>
    );
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Email not verified</strong>
        <p>
          {sent
            ? 'Check your inbox for a verification link.'
            : 'Verify this address so it can be used for account recovery.'}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        className="secondary"
        disabled={sending || sent}
        onClick={() => void send()}
        type="button"
      >
        {sending ? 'Sending…' : sent ? 'Sent' : 'Send verification email'}
      </button>
    </div>
  );
}
