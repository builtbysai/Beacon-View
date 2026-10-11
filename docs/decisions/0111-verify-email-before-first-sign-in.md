# ADR 0111: A password account verifies its email before it can sign in

- Status: Accepted (owner decision of 2026-10-11, audit findings V26 and V47)

## Context

Registration needed no proof that the person owns the address. Someone could register for
another person's email and hold it; the real owner's Google sign-in for that address was then
sent down a "link required" path that needs the squatter's password. Unverified accounts could
also send invitation emails to strangers from Beacon's address.

## Decision

- Where email delivery is configured, a new password account is created, a verification link is
  mailed, and no session is issued (`202 { verificationRequired: true }` on the web and Android
  sign-up). Signing in before the link is opened is refused with `403 email_not_verified`, and
  that attempt mails a fresh link (at most three an hour per account).
- Opening an emailed password-reset link also counts as proof of the address.
- Where email is not configured (local development), nothing changes: verification is
  impossible there, so it is not required.
- Invitations additionally need a verified email (V47) for accounts that predate this rule.
- Google accounts are verified by Google and are unaffected. Production had two accounts when
  this shipped, both Google, so no one was locked out.

## Consequences

- The first sign-in after sign-up needs a working inbox. A lost link is replaced by trying to sign
  in again.
- The Android app and the server must be released together for the new sign-up response; an older
  Android app would show "account could not be created" and the account would still be created.
