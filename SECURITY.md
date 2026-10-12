# Security policy

Beacon View turns a spare Android phone or computer into a camera you can watch remotely, so security and privacy
reports matter to us.

## Reporting a vulnerability

Please report privately and do not open a public issue.

Use GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting).

Include what you found, the steps to reproduce it and the version or commit. You will get an answer within a few
days. Please give us a reasonable time to fix a problem before you publish it, and do not test against other
people's accounts, cameras or data.

## What is in scope

The web app, the backend and signaling service, the Android app, the desktop app and the infrastructure files in
this repository. The threat model is in `docs/threat-model.md`.

## What is not in scope

Social engineering, denial-of-service testing against the hosted service, and findings that need a rooted or
already-compromised device.

## Secrets

No credentials are kept in this repository. If you find one, please report it the same way.
