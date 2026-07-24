# Testing plan

`pnpm check` runs formatting, ESLint, strict TypeScript, backend and web tests,
and all TypeScript builds. Backend unit tests cover security primitives, rate
windows, and the exact presence boundary.

PostgreSQL integration suites run when `TEST_DATABASE_URL` is defined:

```sh
TEST_DATABASE_URL=postgresql://... pnpm --filter @beacon/backend test
```

They cover normalized duplicate accounts, generic login errors, session expiry,
logout revocation, CSRF, transactional concurrent pairing, expired/invalid/reused
codes, heartbeat authorization, and credential revocation. Each suite truncates
only its designated test database tables.

Validate migration state with `db:check`, apply migrations to a clean local
database with `db:migrate`, and inspect the SQL. Validate Compose health and
published ports separately. Android validation runs `assembleDebug` and
`testDebugUnitTest`, followed by a manifest review for prohibited permissions.

Future milestones must add capture lifecycle, signaling, media, reconnect, and
privacy shutdown tests only when those features are approved.
