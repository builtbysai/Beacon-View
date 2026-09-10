import { useState } from 'react';

/** Centralized account-avatar rendering: the Google profile picture when
 * legitimately available (the OAuth `picture` claim, already on the user
 * record - no extra scopes, no scraping), falling back to an initial when
 * there's no picture or it fails to load. Reused anywhere the account's
 * identity is shown (sidebar, Settings) instead of duplicating the
 * image/fallback logic per screen. */
export function Avatar({
  email,
  avatarUrl,
  size = 'md',
  className = '',
}: {
  email: string;
  avatarUrl?: string | null | undefined;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const classes = `avatar avatar-${size} ${className}`.trim();
  if (avatarUrl && !broken) {
    return (
      <img
        className={classes}
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={`${classes} avatar-initial`} aria-hidden="true">
      {email.charAt(0).toUpperCase()}
    </span>
  );
}
