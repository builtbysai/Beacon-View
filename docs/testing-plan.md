# Testing plan

## Milestone 0 automation

- Backend integration test verifies the public health response through Fastify's
  in-process injection API.
- Web component test verifies the placeholder page and explicit inactive-capture
  message.
- CI runs formatting, linting, strict type checking, tests, and production builds.

Run all TypeScript checks with `pnpm check`. Validate infrastructure configuration
with `docker compose -f infrastructure/docker/compose.yaml config --quiet`. Build
Android on Windows with
`apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug`, or use
`./apps/android-camera/gradlew` on macOS and Linux, when the SDK/JDK are available.

Later milestones must add authorization, pairing expiry, credential revocation,
signaling state-machine, reconnect, privacy shutdown, and network-path test cases.
Manual WebRTC testing is intentionally out of scope until streaming exists.
