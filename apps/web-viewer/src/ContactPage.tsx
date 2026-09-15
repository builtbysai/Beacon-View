import { useState, type FormEvent } from 'react';

import { request } from './api';
import { Brand, Icon } from './Icon';

export function ContactPage({
  accountDeletion = false,
}: {
  accountDeletion?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    // Captured now: React nulls out event.currentTarget once the handler's
    // synchronous portion finishes, before the request below resolves.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await request('/api/contact', {
        body: JSON.stringify({
          email: form.get('email'),
          message: form.get('message'),
          name: form.get('name') || undefined,
          subject: form.get('subject'),
          website: form.get('website') || undefined,
        }),
        method: 'POST',
      });
      setSent(true);
      formElement.reset();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Your message could not be sent. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const title = accountDeletion
    ? 'Request account deletion'
    : 'How can we help?';
  const subject = accountDeletion ? 'Account deletion request' : undefined;

  return (
    <main
      className={`auth-layout contact-layout${accountDeletion ? ' account-deletion-layout' : ''}`}
    >
      <header className="auth-header">
        <a href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <span className="alpha-badge">Private alpha</span>
      </header>
      <div className="auth-content contact-content">
        <section className="auth-story" aria-labelledby="contact-title">
          <p className="eyebrow">
            {accountDeletion
              ? 'Account and data controls'
              : 'Help and privacy requests'}
          </p>
          <h1 id="contact-title">
            {accountDeletion ? (
              <>
                Delete your account, <em>your way.</em>
              </>
            ) : (
              <>
                We’re here to <em>help.</em>
              </>
            )}
          </h1>
          <p className="auth-description">
            {accountDeletion
              ? 'Cannot sign in? Send a request and we will verify account control before acting.'
              : 'Send a support, privacy, or account question. Your email is not published here.'}
          </p>
          <div className="auth-promises">
            <span>
              <Icon name="shield" />
              No cloud recordings
            </span>
            <span>
              <Icon name="lock" />
              Privacy-first support
            </span>
          </div>
        </section>
        <section
          className="auth-card card"
          aria-labelledby="contact-form-title"
        >
          <span className="auth-welcome-icon">
            <Icon name="home" />
          </span>
          <p className="eyebrow">Contact Beacon</p>
          <h2 id="contact-form-title">{title}</h2>
          {sent ? (
            <p role="status">
              Thanks, your message has been sent. We'll reply to the email you
              provided.
            </p>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <label>
                Name <span aria-hidden="true">(optional)</span>
                <input name="name" autoComplete="name" maxLength={100} />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={320}
                />
              </label>
              {accountDeletion ? (
                <>
                  <input name="subject" type="hidden" value={subject} />
                  <p className="notice">{subject}</p>
                </>
              ) : (
                <label>
                  Subject
                  <input name="subject" required maxLength={140} />
                </label>
              )}
              <label>
                Message
                <textarea name="message" required maxLength={3000} rows={6} />
              </label>
              <label className="visually-hidden" aria-hidden="true">
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              {error && <p role="alert">{error}</p>}
              <button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send message'}
              </button>
            </form>
          )}
          <p className="auth-footer-note">
            <Icon name="shield" />
            Do not include passwords, pairing codes, tokens, or private media.
          </p>
        </section>
      </div>
      <footer className="auth-footer">
        <a href="/">Back to Beacon</a>
        <a href="/trust">
          Trust and privacy
          <Icon name="arrow" />
        </a>
      </footer>
    </main>
  );
}
