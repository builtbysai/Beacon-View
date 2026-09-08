# ADR 0017: CI readiness gates

## Status

Accepted under the production-readiness development authorization.

## Decision

Keep the existing TypeScript validation job and add separate PostgreSQL, Android,
and secret/workflow-check jobs. PostgreSQL is a disposable CI service with a dedicated
`_test` database and public test-only credentials. Migration credentials exist only
for explicit migration steps; integration tests retain their independent environment
and database-name guards. Apply migrations twice to check clean creation and reruns.

Android uses the hosted Ubuntu 24.04 SDK and Java 17, the checked-in Gradle wrapper,
unit tests, lint, debug compilation, and unsigned release compilation. No production
API URL, signing material, package upload, or deployment is introduced. The Windows
full validator runs these same Android tasks.

Use official digest-pinned Gitleaks and Actionlint containers as development tools,
with read-only source mounts and no runtime network. Gitleaks output is fully redacted
and scans full fetched history. Checkout does not persist an authentication token in
the working copy. No scanner findings are silently baselined or ignored in CI.

## Sources and consequences

The [GitHub runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
documents the hosted Android SDK. The [Gitleaks package](https://github.com/gitleaks/gitleaks/pkgs/container/gitleaks/)
provides the pinned image digest, and [Actionlint's official usage](https://github.com/rhysd/actionlint/blob/main/docs/usage.md)
documents local workflow and shell validation.

Local equivalent commands can be tested without pushing the repository. Hosted CI
still needs a first authorized run; cache/runner differences remain unverified.
Migration reruns do not replace testing populated prior-release schemas, rollback,
backup restores, or production recovery. SBOM generation, comprehensive Android
dependency auditing, protected release signing, and branch/environment protection
remain distinct release gates.
