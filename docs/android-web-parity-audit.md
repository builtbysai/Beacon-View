# Android/web feature-and-design parity audit (roadmap U7)

Status: **documentation only — no implementation has started.** This is the
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
   in a comment. The "make it look identical" ask is *not* starting from
   zero on color.
2. **Typography and spacing are not tokenized on Android at all.** The web
   has a real type scale (`--text-xs` … `--text-4xl`) and spacing scale
   (`--space-0` … `--space-10`); Android uses default Material3 typography
   with two line-height overrides and ad-hoc dp literals everywhere else. This
   is the actual mechanical work behind "make it look identical" — building
   the equivalent scales, not re-picking colors.
3. **The single biggest visual difference is navigation paradigm, not
   styling**: the web uses a collapsible sidebar rail; Android uses a bottom
   tab bar (Home/Cameras/Activity/Settings). This is a real product decision,
   not a bug — bottom nav is the normal Android phone convention — and is
   flagged as an open question rather than treated as a defect.
4. **The real feature gaps are bigger than the design gaps.** Household/
   sharing management, the Clips library (viewing/sharing/deleting recorded
   clips), manual clip recording with a visible indicator, and the motion
   settings panel (sensitivity/cooldown/quiet hours/record-on-motion) all
   exist on web and have **no Android equivalent at all** — not a style
   mismatch, a missing capability. See the prioritized list below.

## Design system comparison

### Color — already aligned, verify don't rebuild

| Token (web name) | Web light | Android (Compose) light | Match? |
|---|---|---|---|
| accent/primary | `#2563eb` | `#2563EB` | ✅ |
| accent-hover / (no direct Android analog) | `#1d4ed8` | `onPrimaryContainer #1D4ED8` | ✅ (same hex, different role name) |
| bg-base / background | `#f9fafb` | `#F9FAFB` | ✅ |
| bg-surface / surface | `#ffffff` | `#FFFFFF` | ✅ |
| border-subtle / surfaceVariant | `#f3f4f6` | `#F3F4F6` | ✅ |
| border-default / outlineVariant | `#e5e7eb` | `#E5E7EB` | ✅ |
| border-strong / outline | `#d1d5db` | `#D1D5DB` | ✅ |
| text-primary / onSurface | `#111827` | `#111827` | ✅ |
| text-secondary / onSurfaceVariant | `#4b5563` | `#4B5563` | ✅ |
| status-error / error | `#dc2626` | `#DC2626` | ✅ |

Dark mode matches the same way (spot-checked `bg-base`/`background`
`#09090b`↔`#09090B`, `bg-surface`/`surface` `#18181b`↔`#18181B`). **Action:
none required for the base palette.** The only real color gap is that
several Android screens use *un-tokenized, one-off literals* that duplicate
existing semantic meaning instead of reusing the shared tokens — e.g.
`#F87171`/`#34D399`/`#8291AB`/`#A78BFA` for camera-card status dots in
`MonitorComponents.kt`, when `BeaconDesign.kt` already defines
`BeaconOnline`/`BeaconOffline`/`BeaconWarning` semantic colors for exactly
that purpose. Fixing that is a small, mechanical cleanup, not a redesign.

### Typography — real gap

| | Web (`tokens.css`) | Android (`BeaconDesign.kt` / Material3 default) |
|---|---|---|
| Font family | `Inter` (Google Fonts), system fallback stack | Material3 default (system sans, set at `styles.xml` level) |
| Scale | `--text-xs: 0.75rem` … `--text-4xl: 2.25rem` (8 steps) | Material3 default `Typography()`, only `headlineLarge`/`bodyLarge` line-heights overridden |
| Weight | ad hoc 500/600/700/800 per component (not tokenized on web either, but consistent values) | ad hoc `FontWeight.Bold/ExtraBold/SemiBold/Medium` per call site |

**Gap**: no shared type-scale token set on Android, and no Inter font
loaded. Building an Android `Typography.kt` with steps that mirror the web's
rem scale (converted to `sp`, e.g. `0.75rem→12sp`, `1rem→16sp`,
`1.5rem→24sp`) and bundling Inter as a Compose font resource would close
this — a bounded, well-defined task.

### Spacing — real gap

Web has a centralized scale: `--space-0` (0) through `--space-10` (4rem),
used throughout via CSS variables. Android has **no spacing constants at
all** — every `padding`/`Arrangement.spacedBy` call uses a literal dp value
chosen per call site (4, 6, 8, 10, 12, 14, 16, 18, 20dp all appear
individually). Closing this means introducing a `Spacing` object (or
`Dimens.kt`) with steps mirroring the web scale and migrating call sites —
mechanical, but touches most Compose files, so it's a real (not trivial)
piece of work.

### Shape/radius — minor gap

Web: 3-step scale (`--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg:
12px`, plus `--radius-full`). Android: ad hoc `RoundedCornerShape` literals
at 8/10/12/14/16dp/999dp — roughly the same *magnitude* but not centralized
and not a clean 3-step match (10dp and 14dp don't correspond to anything on
the web side). Recommend collapsing to the same 3-step scale plus full/pill,
matching the web's actual radius values.

### Navigation paradigm — the actual "look identical" question

Web: collapsible sidebar rail (240px expanded / 72px icon-only), persistent
account menu, portal-rendered tooltips. Android: bottom tab bar (Home,
Cameras, Activity, Settings) — the standard Android phone pattern, and
generally the right one for a phone-sized screen; a sidebar rail is a
desktop/tablet pattern that doesn't translate well to a phone in portrait.
**This is the single biggest source of "doesn't look identical" and it is a
product decision, not a bug** — see Open questions below rather than treating
this as something to simply go fix.

## Screen/feature parity

| Web screen/feature | Android status | Notes |
|---|---|---|
| Dashboard/Home | Equivalent (`MonitorHome`/`MonitorPage.Home`) | Web's favorites grid + latest-activity sidecard ≈ Android's hero panel + top-2 camera grid + 3-item activity preview. Reasonably close already. |
| Cameras catalog | Equivalent (`MonitorPage.Cameras`) | Web has search/filter pills and pagination; Android has favorites-only filter and manual reorder but no text search. Minor gap. |
| Live camera viewer | Equivalent (`AndroidLiveView`/`NativeLiveView.kt`) | Web has more connection sub-states (reconnecting-with-retry-count, signaling-unavailable, etc.) and a full recording UI (see below); Android's live view itself is close. |
| Camera settings (device) | Equivalent (`MonitorDeviceSettings`) | |
| Activity feed (motion events) | Equivalent (`MonitorPage.Activity`) | |
| **Clips library** (view/play/download/share/delete recorded clips) | **Missing entirely** | Android records, encrypts, and uploads motion-triggered clips (`MotionClipUpload.kt`) but never lists, plays, or lets the user manage them afterward. This is a real functional gap, not styling. |
| **Manual clip recording + status indicator** | **Missing** | Web has a manual "record now" control and the persistent `RecordingBadge`. Android only has server-driven motion-triggered recording; no manual control, no visible in-progress indicator (a `Recording` state exists in `StreamingState.kt` but nothing renders it). |
| **Motion settings panel** (sensitivity/cooldown/quiet hours/record-on-motion) | **Missing** (except retention days) | Android has the data models and device-side consumption of server-pushed motion settings, but no UI to view or change them — only motion-*retention* days is editable. Sensitivity, cooldown, quiet hours, and the record-on-motion toggle can only be set from the web app today. |
| **Household/sharing management** (invite/accept/revoke/grants) | **Missing entirely** | No invite, accept, revoke, or grant-editing UI or API calls anywhere in the Android app. |
| **External share links for clips** | **Missing** | Depends on the Clips library existing first. |
| **Client-captured clip thumbnails** | **Missing** | Same — depends on Clips library existing. |
| Account settings — password reset/change | **Missing** | No password-change API call or UI on Android. |
| Account settings — active-sessions list | **Missing** | Android shows only its own signed-in email; no cross-session/device inventory. |
| Account settings — account deletion | Equivalent | Full parity here — confirmation dialog + API call, matches web. |
| Sidebar / persistent account menu | Different pattern, see Navigation paradigm above | Bottom tab bar + in-Settings account actions, not a design bug. |
| Trust/privacy/contact info | Partial | Short inline `BeaconTrustLine` disclosures exist scattered across screens; no dedicated contact-info screen. |
| Account creation / registration | **Web-only by design (verify with owner)** | Android only supports sign-in (email/password or Google); there is no register flow. May be intentional (accounts are created on web, phones are then paired as cameras or added as viewers) rather than a gap — needs an explicit owner confirmation either way. |
| Browser-specific features (PWA install, Web Push subscription flow, Browser Camera Mode, QR *scanning as a browser feature*, guest live-view links, fullscreen API, keyboard shortcuts) | **Not applicable** | These are browser-platform features; Android has its own equivalents where relevant (native FCM push, native QR scanning via ML Kit) or no equivalent is expected (e.g. "browser camera mode" is inherently a browser-only concept — Android's camera mode is already native). Listed for completeness, not as gaps to close. |

## Prioritized recommendation

Ship in this order, because each is independently useful and later items
depend on earlier ones:

1. **Clips library on Android** (view/play/share/delete already-uploaded
   clips). Currently clips are captured and uploaded into a void — the user
   can never see them again from the phone. This is the highest-value gap.
2. **Motion settings panel on Android** (sensitivity/cooldown/quiet
   hours/record-on-motion). Users on Android-only can't currently tune the
   thing that decides whether the Clips library above ever gets anything in
   it.
3. **Manual recording + visible indicator on Android**, mirroring the web's
   `RecordingBadge` pattern once Clips library (1) exists to hold the result.
4. **Household/sharing management on Android.** Larger scope (invite flow,
   grant editing UI) — sequence after 1–3 unless the owner says otherwise.
5. **Design-token work** (typography scale + Inter font, spacing scale,
   radius-scale reconciliation) can happen in parallel with any of the above
   since it's independent, bounded, mechanical work — not gated on the
   feature gaps.
6. **Navigation-paradigm decision** (sidebar vs. bottom nav) should be
   settled before any visual/layout work starts on Settings or Cameras,
   since it affects where every other screen's content lives.

## Open questions for the owner

- **Navigation paradigm**: keep Android's bottom tab bar (the phone-native
  pattern) or attempt a sidebar-like layout to more literally match the web?
  A literal sidebar on a phone-width screen is unusual for Android and may
  fight platform conventions — recommend confirming intent before assuming
  "identical" means "the same widget," not "the same clarity/affordance."
- **Account creation**: is Android intentionally sign-in-only (accounts
  created on web), or is a missing register flow a real gap to close?
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
