# ADR 0042: Migrate the private alpha to an owned domain

Status: Accepted and deployed on September 11, 2026.

## Context

The private alpha currently uses a temporary third-party hostname. Beacon now has the
owned Cloudflare-managed domain `builtbysai.com`. The canonical application hostname
must move without breaking Google OAuth or Android pairing links.

Browser cookies are host-scoped and cannot be transferred to the new domain. Android
production builds also validate HTTPS pairing links against their configured API
origin. The owner chose a hard cutover instead of retaining a compatibility host;
existing browser sessions will be signed out and previously installed native builds
must be updated.

## Decision

- Use `beacon.builtbysai.com` as the canonical application and API origin.
- Keep `auth.builtbysai.com` isolated for transactional email reputation and Resend
  domain verification.
- Initially create the Cloudflare `beacon` A record as DNS-only so Caddy can obtain and
  validate its public certificate directly. Proxying may be evaluated after cutover.
- Serve the canonical web application and API on the new hostname.
- Do not serve, redirect, advertise, or retain runtime configuration for the temporary
  hostname after cutover.
- Advertise only the owned hostname as an Android App Link.
- Add the new Google OAuth callback before changing the production environment and
  remove the former callback from Google after canonical sign-in is verified.
- Change `BEACON_DOMAIN`, `GOOGLE_OAUTH_REDIRECT_URI`, and the Android production API
  build value only after DNS and OAuth prerequisites are verified.

## Cutover checks

1. DNS resolves `beacon.builtbysai.com` to the reserved Oracle IPv4 address.
2. Google OAuth permits
   `https://beacon.builtbysai.com/api/auth/google/callback`.
3. Caddy obtains a valid certificate for the canonical host.
4. `/health`, `/ready`, sign-in, household events, pairing, direct WebRTC, and TURN relay
   pass on the canonical host.
5. A new Android build opens canonical pairing links and completes Google sign-in.

## Consequences

Existing browser users sign in once on the new hostname. Existing native clients that
were built with the former API origin stop connecting and require the canonical-domain
update. Rollback is an application/server deployment decision and does not rely on the
former hostname.

## Deployment result

Cloudflare DNS resolves the canonical hostname directly to the Oracle VM. Google OAuth
uses only the canonical JavaScript origin and callback. Release
`domain-20260911-153201` rebuilt and recreated the backend, TURN, and web services;
database migrations completed and PostgreSQL remained healthy. Public `/health`,
`/ready`, the web application, and the OAuth authorization redirect passed. The former
hostname is no longer served.
