import { useEffect, useState } from 'react';

const RESULT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  conflict: {
    text: 'That Google account is already linked to a different Beacon account.',
    ok: false,
  },
  denied: {
    text: 'Google account linking was not completed.',
    ok: false,
  },
  emailMismatch: {
    text: "That Google account's email does not match this account's email.",
    ok: false,
  },
  failed: {
    text: 'Google account linking failed. Try again.',
    ok: false,
  },
  success: {
    text: 'Google account linked. You can now sign in with either method.',
    ok: true,
  },
};

export function LinkGoogleAccount({ linked }: { linked: boolean }) {
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const result = parameters.get('googleLink');
    if (result && RESULT_MESSAGES[result]) {
      setNotice(RESULT_MESSAGES[result]);
      parameters.delete('googleLink');
      const search = parameters.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    }
  }, []);

  if (linked) {
    return (
      <div className="settings-row">
        <div>
          <strong>Google account linked</strong>
          <p>You can sign in with your password or with Google.</p>
        </div>
        <span className="status-badge status-online">Linked</span>
      </div>
    );
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Link your Google account</strong>
        <p>
          Sign in with either your password or Google afterward. Does not
          affect Google Drive, which connects separately below.
        </p>
        {notice && (
          <p role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>
        )}
      </div>
      <a className="secondary button-link" href="/api/auth/google/link">
        Link Google
      </a>
    </div>
  );
}
