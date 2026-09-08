# Feature opportunity research

Current priority, ownership and approval boundaries are maintained only in
[roadmap.md](roadmap.md#later--deferred--requires-a-separate-approved-milestone).
The original research below is retained as context, not authorization or current status.
Daily quiet hours already suppress motion metadata; they do not stop camera capture.

# Feature opportunities

This is a research backlog, not a commitment to ship every item. Beacon remains an
Android-first, privacy-first live-view product: it does not upload media, perform
facial recognition, or claim end-to-end encryption.

## Highest-value next slices

1. **Reliable event notifications.** Deliver an owner-selected notification for a
   motion event, with per-camera schedules and a fast mute action. Start with
   web-push when the browser supports it; add email only after a verified sending
   domain is available. Notification delivery must be opt-in, rate-limited, auditable,
   and contain no image or private event detail on a lock screen.
2. **Activity zones.** Let an owner exclude non-essential regions from on-device
   motion detection. Detection zones, sensitivity, delay, and object-size controls are
   established ways to reduce false alerts in current camera products
   ([Reolink](https://support.reolink.com/articles/15031501450905-How-to-Set-up-Smart-Motion-Detection-for-Camera/)).
   Beacon should use a simple grid overlay derived from its existing local luma-grid
   detector, apply it before motion metadata is sent, and preserve the current
   no-media-upload guarantee.
3. **Privacy masks.** A camera owner could block selected parts of the local preview
   and outgoing stream, such as a neighbour's window. This is distinct from privacy
   mode: privacy mode stops capture entirely, whereas a mask permits capture only
   outside an excluded region. Competitors render such areas visibly in live view and
   recordings ([Ring](https://partners.ring.com/support/articles/g4e2w/using-privacy-features-in-the-ring-app)).
   This needs careful Android rendering, a clear local disclosure, and physical-device
   acceptance before release.
4. **Actionable device health.** Add local, consent-aware measurements for network
   quality, free storage, foreground-service health, permissions, temperature where
   supported, and sustained battery/charging state. Show a plain-language recovery
   action—not raw diagnostics—on the camera card. Do not collect location or media.
5. **Household sharing.** Add explicit owner, administrator, viewer, and guest roles;
   granular camera access; expiry for guest access; and an audit trail. Account recovery
   and sensitive-change notifications must arrive first.

## Later experiments

- **Feature-flagged on-device person detection.** Only after heat, battery, and
  false-positive evaluation. Support must be device-capability-aware: consumer cameras
  vary substantially in which hardware can perform smart detection
  ([Reolink](https://support.reolink.com/articles/5114827897497-Which-Camera-Supports-Smart-Detection/)).
  No facial recognition, identity storage, or third-party image analysis.
- **Older-device adaptive quality.** Surface a clearly labelled Low-bandwidth mode
  that reduces capture or view quality only after measured device/network limits.
- **Privacy-preserving notification preferences.** Per-user, per-camera quiet
  schedules and motion-notification routing. Do not make a silent change to the
  existing camera-wide metadata quiet-hours setting.
- **Guided camera placement.** A setup checklist for power, Wi-Fi, local capture
  indicator, and view testing. It must not infer rooms or create maps without user
  input.

## Prerequisites and non-features

- A custom domain and verified sender are prerequisites for user-facing email and
  password recovery. Resend onboarding remains suitable only for developer testing.
- Cloud recording, thumbnail uploads, subscriptions, facial recognition, and
  professional monitoring are not implied by this list and require separate product,
  privacy, cost, and legal review.
- Privacy masks and activity zones must be demonstrably applied on the Android capture
  path, not merely hidden in the web viewer.
