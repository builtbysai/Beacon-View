# Architecture

## Milestone 0 scope

Beacon SecureView is an Android-first camera system with three planned runtime
components: an Android camera agent, a responsive web viewer, and a backend API
and signaling service. Milestone 0 creates buildable boundaries only; it does not
implement accounts, pairing, capture, signaling, media, or event processing.

## Component boundaries

- The Android app is an independent Kotlin/Compose client. It must not import
  TypeScript packages or request camera/microphone permissions in this milestone.
- The web viewer is a browser client built with React and Vite.
- The backend is a Node.js 22 Fastify service. It owns runtime configuration and
  future authorization boundaries. The current `/health` route exposes no data.
- `shared-types` contains transport-neutral TypeScript contracts shared only by
  TypeScript applications.
- PostgreSQL and Coturn are isolated local-development services. Neither is yet
  connected to application behavior.

Future camera access must be authorized by the backend; signaling messages and
client-provided identifiers must never be treated as authorization.
