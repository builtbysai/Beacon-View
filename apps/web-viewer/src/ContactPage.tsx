import { useState, type FormEvent } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { Icon } from './Icon';
import { PublicHeader } from './PublicHeader';
import './ContactPage.css';

export function ContactPage({
  accountDeletion = false,
  available = true,
}: {
  accountDeletion?: boolean;
  available?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available) return;
    setBusy(true);
    setError('');
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
        friendlyError(
          caught,
          'Your message could not be sent. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const title = accountDeletion
    ? 'Request account deletion'
    : 'How can we help?';
  const lede = accountDeletion
    ? 'Send a request and we will verify account control before acting.'
    : "Send a support, privacy, or account question. We'll use your email only to respond to your request.";

  const onBack = (e: React.MouseEvent) => {
    e.preventDefault();
    window.history.back();
  };

  const contactAction = (
    <button onClick={onBack} className="ph-back-action">
      &larr; Back to Beacon
    </button>
  );

  return (
    <>
      <PublicHeader
        action={contactAction}
        sticky={false}
        alignContainer="contact"
      />
      <main className="contact-v4">
        <section className="main wrap">
          <div className="intro">
            <p className="eyebrow">{accountDeletion ? 'Privacy' : 'Contact'}</p>
            <h1>{title}</h1>
            <p className="lede">{lede}</p>

            {!accountDeletion && (
              <div className="options">
                <div className="option">
                  <div className="ico">
                    <Icon name="info" />
                  </div>
                  <div>
                    <h2>Product support</h2>
                    <p>
                      Setup, cameras, connections, or something not working as
                      expected.
                    </p>
                  </div>
                </div>
                <div className="option">
                  <div className="ico">
                    <Icon name="user" />
                  </div>
                  <div>
                    <h2>Account</h2>
                    <p>
                      Questions about signing in or managing your Beacon
                      account.
                    </p>
                  </div>
                </div>
                <div className="option">
                  <div className="ico">
                    <Icon name="lock" />
                  </div>
                  <div>
                    <h2>Privacy</h2>
                    <p>Privacy questions or requests related to your data.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <section className="card" aria-live="polite">
            {error && !sent && (
              <div className="auth-alert" role="alert">
                {error}
              </div>
            )}
            {!available && !sent && (
              <div className="auth-alert" role="alert">
                Contact delivery is not configured on this Beacon server.
              </div>
            )}

            <div className={`form ${sent ? 'hide' : ''}`} id="form">
              <div className="cardhead">
                <div>
                  <h2>Send a message</h2>
                  <p>All fields except name are required.</p>
                </div>
              </div>
              <form onSubmit={(e) => void submit(e)}>
                <div className="twocol">
                  <div className="field">
                    <label htmlFor="name">
                      Name{' '}
                      <span
                        style={{ fontWeight: 400, color: 'var(--text-muted)' }}
                      >
                        (optional)
                      </span>
                    </label>
                    <input
                      id="name"
                      name="name"
                      autoComplete="name"
                      maxLength={100}
                      disabled={busy || !available}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={busy || !available}
                    />
                  </div>
                </div>

                {!accountDeletion && (
                  <div className="field">
                    <label htmlFor="topic">What can we help with?</label>
                    <select id="topic" required disabled={busy || !available}>
                      <option value="">Choose a topic</option>
                      <option>Product support</option>
                      <option>Account</option>
                      <option>Privacy</option>
                      <option>Other</option>
                    </select>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="subject">Subject</label>
                  <input
                    id="subject"
                    name="subject"
                    required
                    disabled={busy || !available}
                    defaultValue={
                      accountDeletion ? 'Account deletion request' : ''
                    }
                    readOnly={accountDeletion}
                  />
                </div>
                <div className="field">
                  <label htmlFor="message">Message</label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    disabled={busy || !available}
                    placeholder="Tell us what happened or what you need help with."
                  ></textarea>
                </div>

                <div className="actions">
                  <div className="safety">
                    <span
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 14,
                        height: 14,
                      }}
                    >
                      <Icon name="shield" />
                    </span>
                    <span>
                      Don't include passwords, private media, or other sensitive
                      information.
                    </span>
                  </div>
                  <button className="send" disabled={busy || !available}>
                    {busy
                      ? 'Sending…'
                      : available
                        ? 'Send message'
                        : 'Unavailable'}
                  </button>
                </div>
              </form>
            </div>

            <div className={`sent ${sent ? 'show' : ''}`} id="sent">
              <div className="check">
                <Icon name="check" />
              </div>
              <h2 role="status">Message sent</h2>
              <p>
                Thanks for contacting Beacon. Your message has been received.
              </p>
              <a
                className="back"
                href="/"
                style={{ color: 'var(--accent-base)' }}
              >
                Return to Beacon →
              </a>
            </div>
          </section>
        </section>

        <footer className="wrap">
          <span>Beacon · Private alpha</span>
          <div className="links">
            <a href="/trust">Trust & privacy</a>
            <a href="/">Return to Beacon</a>
          </div>
        </footer>
      </main>
    </>
  );
}
