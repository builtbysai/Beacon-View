import { useState } from 'react';
import { request } from './api';
import { SettingsRow } from './SettingsUI';

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
      <SettingsRow
        title="Email verified"
        description="This address can be used to recover your account."
      >
        <span className="status-badge status-online">Verified</span>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow
      title="Email not verified"
      description={
        <>
          {sent
            ? 'Check your inbox for a verification link.'
            : 'Verify this address so it can be used for account recovery.'}
          {error && <span role="alert">{` ${error}`}</span>}
        </>
      }
    >
      <button
        className="secondary"
        disabled={sending || sent}
        onClick={() => void send()}
        type="button"
      >
        {sending ? 'Sending…' : sent ? 'Sent' : 'Send verification email'}
      </button>
    </SettingsRow>
  );
}
