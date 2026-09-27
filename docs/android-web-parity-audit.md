# Android/web feature-and-design parity audit (roadmap U7)

Status: **audit complete; implementation has begun in reviewed slices.** This is the
audit [core-feature-completion-plan.md](core-feature-completion-plan.md) and
[roadmap.md](roadmap.md) (row U7) required before any Android UI or feature
work begins, produced by reading both codebases end to end (not by running
the apps). The owner asked for two things: make the Android app's look match
the current PWA, and make sure neither platform is missing features the
other has. Those are two different audits and this doc keeps them separate,
because the fixes are different in kind — one is design-token work, the
other is feature-gap work, and the biggest gap this audit found is a
navigation-paradigm difference, not a color difference.

## Headline findings

1. **Color tokens already match.** Android's `BeaconDesign.kt` color scheme
   was deliberately copied from the web's CSS tokens — the file even says so
   in a comment. The "make it look identical" ask is _not_ starting from
   zero on color.
2. **Typography and spacing were the main mechanical design gap.** The
   September 27 implementation now bundles Inter and maps the web type,
   spacing, radius, shape, and color tokens into Compose. Existing older
   screens still contain literals to migrate incrementally.
3. **The navigation decision is settled.** At the owner's direction, Android
   now follows the PWA's phone layout: a 54dp top bar opens a modal 280dp
   sidebar with Home, Cameras, Events, and Settings. Activity and Clips are
   sibling views inside Events, and the account footer exposes theme, Trust &
   privacy, and Sign out.
4. **The real feature gaps are bigger than the design gaps.** Household/
   sharing management, the Clips library (viewing/sharing/deleting recorded
   clips), manual clip recording with a visible indicator, and the motion
   settings panel (sensitivity/cooldown/quiet hours/record-on-motion) all
   exist on web and have **no Android equivalent at all** — not a style
   mismatch, a missing capability. See the prioritized list below.

## Design system comparison

### Color — already aligned, verify don't rebuild

| Token (web name)                          | Web light | Android (Compose) light      | Match?                             |
| ----------------------------------------- | --------- | ---------------------------- | ---------------------------------- |
| accent/primary                            | `#2563eb` | `#2563EB`                    | ✅                                 |
| accent-hover / (no direct Android analog) | `#1d4ed8` | `onPrimaryContainer #1D4ED8` | ✅ (same hex, different role name) |
| bg-base / background                      | `#f9fafb` | `#F9FAFB`                    | ✅                                 |
| bg-surface / surface                      | `#ffffff` | `#FFFFFF`                    | ✅                                 |
| border-subtle / surfaceVariant            | `#f3f4f6` | `#F3F4F6`                    | ✅                                 |
| border-default / outlineVariant           | `#e5e7eb` | `#E5E7EB`                    | ✅                                 |
| border-strong / outline                   | `#d1d5db` | `#D1D5DB`                    | ✅                                 |
| text-primary / onSurface                  | `#111827` | `#111827`                    | ✅                                 |
| text-secondary / onSurfaceVariant         | `#4b5563` | `#4B5563`                    | ✅                                 |
| status-error / error                      | `#dc2626` | `#DC2626`                    | ✅                                 |

Dark mode matches the same way (spot-checked `bg-base`/`background`
`#09090b`↔`#09090B`, `bg-surface`/`surface` `#18181b`↔`#18181B`). **Action:
none required for the base palette.** The only real color gap is that
several Android screens use _un-tokenized, one-off literals_ that duplicate
existing semantic meaning instead of reusing the shared tokens — e.g.
`#F87171`/`#34D399`/`#8291AB`/`#A78BFA` for camera-card status dots in
`MonitorComponents.kt`, when `BeaconDesign.kt` already defines
`BeaconOnline`/`BeaconOffline`/`BeaconWarning` semantic colors for exactly
that purpose. Fixing that is a small, mechanical cleanup, not a redesign.

### Typography — foundation implemented

|             | Web (`tokens.css`)                                                                        | Android (`BeaconDesign.kt` / Material3 default)                      |
| ----------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Font family | `Inter` (Google Fonts), system fallback stack                                             | Bundled Inter 4.1 under the SIL Open Font License                    |
| Scale       | `--text-xs: 0.75rem` … `--text-4xl: 2.25rem` (8 steps)                                    | `BeaconTypography` maps the same 12sp–36sp scale into Material roles |
| Weight      | ad hoc 500/600/700/800 per component (not tokenized on web either, but consistent values) | ad hoc `FontWeight.Bold/ExtraBold/SemiBold/Medium` per call site     |

**Implemented September 27**: Android now has a shared type scale and bundled
Inter font. Remaining work is migrating older ad-hoc literals to the shared
roles rather than creating another design system.

### Spacing — foundation implemented, migration ongoing

Web has a centralized scale: `--space-0` (0) through `--space-10` (4rem),
used throughout via CSS variables. Android now exposes the corresponding
`BeaconSpacing` scale. New parity surfaces use it; older screens still contain
literal dp values and should move incrementally to avoid an unreviewable bulk
rewrite.

### Shape/radius — foundation implemented, migration ongoing

Web: 3-step scale (`--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg:
12px`, plus `--radius-full`). Android now provides the matching
`BeaconRadii` and `BeaconShapes` values. Older ad-hoc shapes remain migration
work; the parity screens no longer need new one-off radius definitions.

### Navigation paradigm — owner decision implemented

Web desktop uses a collapsible rail; web mobile uses a modal drawer. Android now
matches that mobile behavior and destination grouping. The implementation is
native Compose rather than a WebView, while the width, labels, active rail,
scrim, account footer, and account-menu actions mirror the installed PWA.

Android also now branches on window width (`LocalConfiguration.screenWidthDp
>= 600`, Android's own phone/tablet breakpoint): below it, the modal drawer
above; at or above it, a permanent sidebar sits beside the content instead,
mirroring the web's own desktop-rail behavior rather than stretching the
phone-width drawer across a tablet or unfolded foldable. Compile/lint-verified
only — no tablet, foldable, or ≥600dp emulator was available to visually
confirm the wide layout; that's the next acceptance step, not yet done.

## Screen/feature parity

| Web screen/feature                                                                                                                                                                      | Android status                                     | Notes                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard/Home                                                                                                                                                                          | Equivalent (`MonitorHome`/`MonitorPage.Home`)      | Web's favorites grid + latest-activity sidecard ≈ Android's hero panel + top-2 camera grid + 3-item activity preview. Reasonably close already.                                                                                                                                                                                               |
| Cameras catalog                                                                                                                                                                         | Equivalent (`MonitorPage.Cameras`)                 | Web has search/filter pills and pagination; Android has favorites-only filter and manual reorder but no text search. Minor gap.                                                                                                                                                                                                               |
| Live camera viewer                                                                                                                                                                      | Equivalent (`AndroidLiveView`/`NativeLiveView.kt`) | Web has more connection sub-states (reconnecting-with-retry-count, signaling-unavailable, etc.) and a full recording UI (see below); Android's live view itself is close.                                                                                                                                                                     |
| Camera settings (device)                                                                                                                                                                | Equivalent (`MonitorDeviceSettings`)               |                                                                                                                                                                                                                                                                                                                                               |
| Activity feed (motion events)                                                                                                                                                           | Equivalent (`MonitorPage.Events`, Activity tab)    |                                                                                                                                                                                                                                                                                                                                               |
| **Clips library** (view/play/download/share/delete recorded clips)                                                                                                                      | **Implemented locally**                            | Grant-filtered listing, pagination, integrity-checked app-private playback, owner deletion, owner-only time-limited share links (mirrors the PWA's ShareClipDialog, ADR 0077), and best-effort thumbnail display (decrypts an existing thumbnail if one exists; a missing one never blocks the row, ADR 0078) are implemented. Explicit export/download and playback/sharing/thumbnail acceptance against a real clip fixture remain open -- compile/lint/unit-test verified only, not yet exercised against a real recorded clip.                                                                                                                          |
| **Manual clip recording + status indicator**                                                                                                                                            | **Implemented locally**                            | Owner-only Android requests create the normal audited recording row, then the backend commands the authenticated camera socket. The camera reuses bounded CameraX capture plus encrypted Drive upload; viewer, camera UI, and foreground notification expose recording state. Coordinated deployment and real capture acceptance remain open. |
| **Motion settings panel** (sensitivity/cooldown/quiet hours/record-on-motion)                                                                                                           | **Implemented locally**                            | Owners/admins can select a source and edit detection, sensitivity, record-on-motion, cooldown, and time-zone-aware quiet hours through the existing backend contract. Android gates and the Pixel empty state pass; a physical save/apply round trip remains open because the current household returned no editable motion rows.             |
| **Household/sharing management** (invite/accept/revoke/grants)                                                                                                                          | **Missing entirely**                               | No invite, accept, revoke, or grant-editing UI or API calls anywhere in the Android app.                                                                                                                                                                                                                                                      |
| **External share links for clips**                                                                                                                                                      | **Missing**                                        | Depends on the Clips library existing first.                                                                                                                                                                                                                                                                                                  |
| **Client-captured clip thumbnails**                                                                                                                                                     | **Missing**                                        | Same — depends on Clips library existing.                                                                                                                                                                                                                                                                                                     |
| Account settings — password reset/change                                                                                                                                                | **Partial**                                        | Enumeration-resistant signed-out reset request is native; password change for a signed-in account remains open.                                                                                                                                                                                                                               |
| Account settings — active-sessions list                                                                                                                                                 | **Missing**                                        | Android shows only its own signed-in email; no cross-session/device inventory.                                                                                                                                                                                                                                                                |
| Account settings — account deletion                                                                                                                                                     | Equivalent                                         | Full parity here — confirmation dialog + API call, matches web.                                                                                                                                                                                                                                                                               |
| Sidebar / persistent account menu                                                                                                                                                       | Implemented                                        | Matches the PWA mobile drawer grouping and account menu, including Light/System/Dark preference, Trust & privacy, and Sign out.                                                                                                                                                                                                               |
| Trust/privacy/contact info                                                                                                                                                              | Partial                                            | Auth links open the first-party Trust and Contact pages; short native disclosures remain throughout the app. Dedicated native public pages remain open.                                                                                                                                                                                       |
| Account creation / registration                                                                                                                                                         | **Implemented locally**                            | Native registration shares the browser password schema, rate-limit bucket, account creation, duplicate/Google-account handling, verification email, and session issuer; it returns a revocable bearer session. Deployment and real-account acceptance remain open.                                                                            |
| Browser-specific features (PWA install, Web Push subscription flow, Browser Camera Mode, QR _scanning as a browser feature_, guest live-view links, fullscreen API, keyboard shortcuts) | **Not applicable**                                 | These are browser-platform features; Android has its own equivalents where relevant (native FCM push, native QR scanning via ML Kit) or no equivalent is expected (e.g. "browser camera mode" is inherently a browser-only concept — Android's camera mode is already native). Listed for completeness, not as gaps to close.                 |

Implementation began September 27 on
`codex/android-clips-library`: Android clip listing, authorized local playback,
pagination, and owner deletion, followed by native motion settings. Physical
clip validation, a live motion save/apply round trip, sharing, thumbnails, and
the remaining recommendations below stay open.

## Prioritized recommendation

Ship in this order, because each is independently useful and later items
depend on earlier ones:

1. **Clips library on Android** (view/play/share/delete already-uploaded
   clips). Currently clips are captured and uploaded into a void — the user
   can never see them again from the phone. This is the highest-value gap.
2. **Complete motion-settings acceptance on Android.** The native panel now
   covers sensitivity, cooldown, quiet hours, and record-on-motion. Re-test the
   save/apply path with a device whose backend returns editable motion rows.
3. **Complete manual-recording acceptance on Android.** The owner-only control,
   persistent viewer/camera indicators, server-authorized command, and encrypted
   upload reuse are implemented. Deploy the coordinated backend/APK change and
   prove one real Drive-backed capture, failure, and Clips-library playback.
4. **Household/sharing management on Android.** Larger scope (invite flow,
   grant editing UI) — sequence after 1–3 unless the owner says otherwise.
5. **Finish token migration and screen-by-screen visual QA.** The shared Inter,
   type, spacing, radius, shape, top-bar, and sidebar foundations now exist;
   older screen literals and responsive states still need systematic review.

## Open questions for the owner

- **Registration deployment acceptance**: once the backend route is deployed,
  validate real account creation, verification-email delivery, sign-out, and
  sign-back-in on the Pixel without retaining test accounts.
- **Sequencing**: does the prioritized order above match the owner's sense
  of what matters most, or should Household/sharing move earlier?
- This audit is scoped to screens/features/design tokens only. It does not
  cover accessibility parity (TalkBack vs. web screen readers, focus order,
  reduced-motion) — that would need its own pass once the feature/design gaps
  above are resolved, since matching behavior on non-existent screens isn't
  meaningful yet.

## Incidental finding (not part of this audit's scope)

`apps/web-viewer/src/LiveCameraSettingsDialog.tsx` appears to have no
importers anywhere in the web-viewer source — it looks like dead code left
over from an earlier design. Flagged here for a separate look; not touched or
removed as part of this audit.
