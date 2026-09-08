# 0033 — Adopt the trust-first Beacon design system

Date: 2026-09-07

## Status

Accepted for the web and Android experience rebuild.

## Context

The first Beacon design package establishes a coherent visual and interaction system:
Paper and Evening themes, Schibsted Grotesk with Newsreader for editorial emphasis,
clear status labels paired with non-colour glyphs, deliberate audio controls, and
explicit capture/privacy states. These principles align with Beacon's product priorities
of visible capture, privacy, reliability, accessibility, and consumer setup.

## Decision

Implement the package as a product design source of truth, with these non-negotiable
adaptations:

1. Every status uses text and a shape/glyph as well as colour. Interactive targets meet
   44 CSS px on web and 48 dp on Android; local Privacy controls receive extra prominence.
2. The UI must only describe facts the service can verify. An offline device cannot be
   described as having received a remote Privacy command; the UI must say it will apply
   when the device reconnects.
3. Audio begins off for each new or recovered live-view session. Listening and talk are
   separate deliberate actions with clear device-side signalling.
4. Do not add advertising, cloud recording, facial recognition, person detection,
   behavioural analytics, session geolocation, or browser fingerprinting to satisfy a
   mockup. Those are out of scope or require a fresh approved decision.
5. Large Monitor layouts remain design-only until stream-capacity, device performance,
   and service limits have been defined and tested. Android Monitor remains single-camera.
6. Use locally bundled or self-hosted production fonts with resilient system fallbacks;
   the design-package Google Fonts links are not a production data-flow decision.
7. Design-only states that require missing backend capability (account linking, password
   reset, per-device favourites, detailed viewer identity, or broad browser session
   details) must be shown only when the capability exists, or represented with truthful
   transitional copy.

## Consequences

The rebuild receives a stable aesthetic and accessibility vocabulary without creating
false privacy, functionality, or encryption claims. Delivery is staged: token and shell
foundation, high-frequency web screens, truth-preserving error states, then Android
Camera and Monitor surfaces after device validation.
