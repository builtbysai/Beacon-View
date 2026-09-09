# Historical milestone record

Archived September 7, 2026. These prior status notes are historical, not current
authorization. Use [roadmap.md](roadmap.md) for scope, status and release decisions.

# Product roadmap

Milestones 1-6 established accounts, pairing, WebRTC, physical Android LAN
operation, persistent multi-viewer signaling, browser producers, and separate
device/camera-source identities.

Milestone 7 established functional completeness and reliability foundations:
safe test databases, device-centric routes, multi-viewer cleanup, browser
camera mode, reconnect behavior, and LAN/TURN acceptance tooling.

The current operational-polish milestone completes distinct device/source
management semantics, safe deletion, realtime management updates, coordinated
exclusive-source switching, background-operation diagnostics, and lifecycle
documentation.

Milestone 8 establishes the Beacon product experience and design-system
foundation: semantic light/dark tokens, a responsive household shell, consumer
dashboard and cards, advanced-only diagnostics, a context-preserving Live View,
clear Browser Camera Mode limitations, and aligned Android color semantics.

Rooms, Activity, People, recording, and AI modules remain future work because
the current platform does not yet provide their required data or complete
behavior. The extension boundaries and manual acceptance matrix are documented
in `product-experience.md`.

Milestone 9 adds the Monitor route and local workspace layouts for 1 through 16
cameras. Each tile owns an independent WebRTC lifecycle, preserves its stream
while reordered, suspends when distant or in a hidden tab, and supports
source-local switching and in-application fullscreen. Workspace ordering,
layout, and refresh preference are stored as versioned user-scoped browser
preferences. Room filtering remains deferred until room metadata exists.

The post-Milestone-9 stabilization milestone consolidates Windows setup,
startup, shutdown, Android installation, and full validation behind top-level
PowerShell launchers. It also reconciles documentation with the implemented
foreground-service and Monitor behavior. The next feature milestone is not yet
approved; privacy mode and access history are the recommended security-first
boundary after real-device and multi-camera acceptance.

The security-first follow-up is complete. Its first bounded delivery
exposes household-scoped recent live-view access history from the existing audit
log while excluding IP addresses, connection identifiers, credentials, and
signaling data. Backend-enforced Android privacy mode now rejects new viewers,
closes active viewers, and commands the foreground service to release capture
without revoking its credential. Android now provides the same account-synchronized
privacy control locally, restores persisted privacy state after process restart,
and has passed physical-device stop/resume acceptance without re-pairing.
Browser-producer privacy remains deferred because browsers cannot guarantee
unattended capture lifecycle semantics.

The next product milestone is a native Android monitor role so a signed-in Android
device can act as a viewer as well as a camera. That milestone requires an explicit
viewer-session boundary, mode navigation, lifecycle-aware playback, and careful
camera/monitor concurrency behavior; it must reuse the existing signaling and
authorization contracts rather than duplicating them.

The first two Android Monitor slices are implemented: a separately encrypted,
revocable account session; Camera/Monitor navigation that leaves the foreground
camera role independent; a native household camera inventory with online, offline,
privacy, and viewer-count status; and native WebRTC live playback authorized by the
account session. Each Android viewer owns its renderer, peer connection, and retry
lifecycle, and transient socket failures reconnect without restarting Camera Mode.
Previous/next navigation switches directly between household cameras while disposing
only the active viewer. Android Monitor also suspends and fully releases remote-view
media resources when its Activity stops, then reconnects automatically when it starts
again. A fuller native monitoring layout is the next bounded slice.

Android camera browsing now adapts to the current window rather than assuming a
device category: compact windows use one column, medium windows two, and expanded
windows three. This keeps phone controls large while using tablets, foldables, and
desktop-windowed Android efficiently. Native multi-camera simultaneous playback is
still deferred until thermal, decoder, and bandwidth limits can be measured safely.

The first audio slice adds explicit-permission, camera-to-viewer microphone audio to
the shared WebRTC session. The camera foreground notification discloses microphone
capture, privacy mode releases audio with video, and web and Android viewers remain
muted until the user chooses Listen. The subsequent web-to-Android talk slice adds
server arbitration and strict microphone cleanup; physical echo, routing, and relay
acceptance remain required.

Android now uses one consistent Camera / Monitor destination switch across paired and
pairing states and remembers the last destination. This replaces redundant mode buttons
without coupling Monitor navigation to the foreground camera service.

Android Live View now expands in place to a full-window renderer without rebuilding its
viewer session. System Back exits fullscreen first, rotation remains supported, and the
explicit Listen/Mute control remains accessible in the expanded presentation.

Android preserves the selected Live View identifier across Activity recreation, makes
each available camera card a single large accessible action, and presents QR scanning
as the primary pairing path with manual code entry as a fallback.

Android Monitor now supports account-isolated camera Favorites. The encrypted native
session retains the server user ID needed for preference scoping, with a backward-
compatible pseudonymous scope for sessions saved before this field existed. Favorites
can be filtered without creating additional media subscriptions, while the saved camera
order remains stable.

Android Monitor camera ordering is now an account-scoped local preference. Explicit
Earlier/Later controls keep ordering keyboard and screen-reader accessible, newly
discovered cameras append automatically, and Previous/Next Live View follows the saved
order without adding media subscriptions.

The first motion-events slice performs lightweight luma-grid frame differencing on the
active Android camera at a reduced sampling rate. Device and backend cooldowns suppress
event floods, and the backend independently verifies the reporting credential, source,
enabled state, and privacy state. The web Events view lists only server timestamps,
camera names, and scene-change confidence; no image, recording, audio, or recognition
label is uploaded. Production retention controls, sensitivity settings, notification
delivery, and false-positive tuning remain later bounded slices.

The first two-way audio slice adds explicit Talk / Stop talking controls to web Live
View, one server-arbitrated talk owner per camera, a receive-only Android audio path,
camera-side start/end tones, and microphone cleanup on every terminal lifecycle path.
Opening a stream never requests the viewer microphone. Physical echo, speaker routing,
volume, Bluetooth, TURN-path audio, and poor-network acceptance remain required, and
native Android Monitor talk is still deferred.

Activity now offers refresh through the household event channel, retains camera/time
filters per signed-in browser user, and loads older matching metadata using
household-scoped server filtering and cursor pagination. Day grouping, camera actions,
retry and empty states, and explicit refresh preserve the reader's place. A
CSRF-protected household history deletion action has confirmation and an audit record;
clearing history elsewhere invalidates the open list. Configurable automatic retention
remains required before production deployment.

The production-readiness continuation hardens web Talk consent and track lifetime
without rebuilding the video connection, improves camera availability cards and
responsive navigation, and extends CI to PostgreSQL integration, Android lint and
unsigned release compilation, and redacted secret scanning. The detailed evidence
and remaining release gates are in `pre-deployment-readiness.md`. No production
deployment, release signing, account-security change, commit, or push is authorized.

The next reliability slices make backend motion authorization/cooldown insertion
atomic under concurrent reports and keep Android privacy paused when synchronization
fails. Unconfirmed local pause intent is retained across service restart; stale
responses cannot override newer observed privacy decisions. Physical failure and
recovery acceptance remains open. See ADRs 0019 and 0020.

Motion detection now has owner-controlled settings for each Android camera source:
enablement, low/medium/high scene-change sensitivity, and a 30-second, one-minute,
two-minute, or five-minute cooldown. Defaults retain prior behavior. The phone applies
its latest authenticated settings without restarting video, while the backend remains
the authority for disabled-source suppression and cooldowns. Schedules, quiet hours,
activity zones, calibration, notifications, and physical false-positive validation are
separate next slices; see ADR 0021.

The current interface polish makes the web entry point and household home feel like a
consumer camera product: a privacy explanation before sign-in, a compact signed-in
shell, status-first camera cards that require an explicit live-view action, and a
device-health summary with specific recovery guidance. The visual cards are symbolic,
not stored thumbnails or automatic streams. Current Google Home guidance informed the
status-first card and explicit camera-off patterns; sources and decisions are recorded
in `consumer-experience-research.md`.

The approved next bounded reliability slice adds owner-configured daily quiet hours to
each Android camera source. The setting uses an explicit IANA time-zone interval,
Android suppresses local detector output, and the backend independently suppresses
motion-event insertion for stale or manipulated clients. It affects metadata only;
privacy mode and live capture semantics are unchanged. See ADR 0023.

Households can now retain motion metadata for 1, 7, 30, or 90 days, with a
30-day default. The backend hides expired events immediately and an hourly
single-instance job permanently removes them with deletion-count audit evidence.
This applies only to motion metadata, not access history, backups, media, or
recordings; see ADR 0025. Backup expiry and restore verification remain release
gates.

Household owners can now review and revoke their own active browser sessions
without exposing browser fingerprints, IP addresses, token values, or session
identifiers in the interface or audit log. Revoking the current browser signs
it out locally. Email verification, reset, MFA, and account deletion remain
separate account-lifecycle work; see ADR 0026.
