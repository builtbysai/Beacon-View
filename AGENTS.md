# Beacon SecureView repository instructions

This repository contains Beacon SecureView, an Android-first system that turns an unused Android phone into a remotely accessible smart security camera.

## Product priorities

1. Security and privacy
2. Correctness and reliability
3. Simple consumer setup
4. Efficient operation on older devices
5. Maintainability
6. Cost-conscious infrastructure

## Working rules

* Read `docs/product-build-brief.md` before planning or implementing work.
* Follow `docs/testing-policy.md`: protect realistic regressions with the smallest useful suite; review nearby tests and report validation without test counts or coverage targets.
* Work on one approved milestone at a time.
* Do not begin a later milestone without explicit approval.
* Do not work directly on `main`.
* Never commit credentials, tokens, signing keys, private certificates, or `.env` files.
* Do not weaken security controls merely to make tests pass.
* Prefer mature, well-maintained dependencies.
* Avoid unnecessary services, abstractions, and infrastructure.
* Record significant technical decisions under `docs/decisions/`.
* Keep implementation and documentation consistent.
* Update local-development instructions when setup requirements change.
* Run all relevant formatting, linting, type-checking, build, and test commands before presenting work.
* Report failed checks and unresolved security concerns honestly.
* Do not commit, push, or open a pull request unless explicitly instructed.

## Architecture boundaries

The planned system contains:

* An Android camera agent
* A responsive web viewer
* A backend API and WebRTC signaling service
* PostgreSQL
* STUN and TURN infrastructure
* Shared schemas and documentation where appropriate

The initial implementation is Android-first. Do not add iOS, desktop applications, cloud recording, subscriptions, facial recognition, enterprise features, Kubernetes, Kafka, or microservices unless a later approved milestone explicitly requires them.

## Privacy rules

* Camera and microphone capture must always be visible to the camera-device user.
* Privacy mode must stop capture immediately.
* Do not implement hidden recording or surveillance behavior.
* Do not upload media without an explicit approved feature and documented user consent.
* Do not claim end-to-end encryption unless the implementation and threat model justify the claim.
* Do not implement facial recognition or biometric identity storage.

## Required workflow

Before a substantial change:

1. Inspect the relevant repository files.

2. Summarize the current state.

3. State assumptions.

4. Propose the smallest testable implementation.

5. Implement only the approved scope.

6. Run validation.

7. Review the resulting diff.

8. Report risks, known limitations, and decisions requiring human approval.
