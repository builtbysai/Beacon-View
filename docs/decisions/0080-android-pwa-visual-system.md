# ADR 0080: Share the PWA visual system with the Android app

- Status: Superseded by [ADR 0121](0121-android-hosts-the-web-app.md) (the app now shows the web app itself, so visual parity is by construction)
- Date: 2026-09-27

## Context

Beacon's responsive web viewer has become the clearest expression of the
product's interface: quiet neutral surfaces, compact borders, a restrained
blue accent, the Inter typeface, and direct privacy language. The Android app
already covered the core camera and monitor workflows, but it used an older
Material-default presentation and its signed-out flow lacked password recovery
and account-registration access. This made the two clients feel like separate
products and made capability parity difficult to evaluate.

The desktop PWA's persistent rail would consume too much phone width, but the
PWA already solves that at its mobile breakpoint with a modal drawer. The owner
explicitly selected that same mobile navigation behavior for Android instead of
the app's earlier bottom navigation.

## Decision

- Android owns a small set of semantic color, spacing, radius, shape, and type
  tokens derived from the PWA tokens. New native screens should use those
  values instead of introducing unrelated constants.
- Android bundles Inter 4.1 under its SIL Open Font License so native rendering
  does not depend on a network font request. The license is stored beside the
  Android app source in `apps/android-camera/INTER-LICENSE.txt`.
- The landing and authentication surfaces follow the PWA's content hierarchy,
  button treatment, trust language, and dark viewer-preview motif while
  remaining native Compose UI.
- Android follows the PWA's mobile navigation model: a 54-pixel-equivalent
  top bar opens a modal 280-pixel-equivalent sidebar with Home, Cameras,
  Events, and Settings. Activity and Clips are sibling views within Events,
  matching the PWA rather than appearing as separate primary destinations.
- Password-reset requests are native and enumeration resistant. Native
  registration uses `/api/mobile/auth/register`, which shares the browser
  registration password schema, IP rate-limit bucket, account creation,
  duplicate/Google-account handling, verification-email delivery, and session
  issuer. Its only platform-specific behavior is returning a revocable bearer
  session instead of browser cookies.
- Visual parity must not hide capture state, weaken privacy mode, or imply that
  a feature exists before its real workflow is implemented and tested.

## Consequences

- The clients now share a recognizable visual language without coupling
  Compose to web CSS or requiring a WebView.
- Inter adds about 860 KiB of uncompressed source font data to the Android
  project. A later release-size pass may subset it if that can be done while
  retaining the weights and characters Beacon uses.
- Platform primitives remain native Compose components, but the responsive
  hierarchy, labels, destination grouping, and drawer behavior match the PWA.
- Native account registration is now available without introducing a weaker
  second account-creation policy. Production use still depends on deploying the
  backend endpoint and then completing a real-account acceptance test.
