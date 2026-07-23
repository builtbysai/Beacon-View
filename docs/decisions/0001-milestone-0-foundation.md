# ADR 0001: Milestone 0 monorepo foundation

- Status: Accepted for foundation implementation
- Date: 2026-07-22

## Context

The project needs a small, testable foundation for Android, web, backend, shared
contracts, documentation, and local infrastructure without implementing product
features prematurely.

## Decision

Use pnpm workspaces; TypeScript with strict checking for Fastify and React/Vite;
Kotlin with Jetpack Compose for Android; Zod for startup environment validation;
Vitest for TypeScript tests; and Docker Compose for loopback-bound PostgreSQL and
Coturn. Fastify's built-in Pino integration provides structured logging. No ORM,
database client, Redis, media library, authentication library, or cloud service is
introduced in Milestone 0.

## Consequences

The initial codebase stays small and shares contracts between TypeScript apps while
keeping Android independent. Database migrations and persistence are deferred until
their domain model is approved. Production infrastructure and security controls are
not implied by the local Compose configuration.
