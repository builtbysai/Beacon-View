# Register Beacon's Google Cast receiver

Reviewed October 9, 2026 against the October 9 handoff (`80e53c5`),
ADR 0097, and Google's current registration instructions.

## Activation record — October 9, 2026

- Owner reports Cast developer registration/payment and Google Play developer
  registration/payment complete.
- Custom Receiver **Beacon SecureView** registered successfully with application
  ID `E850DDA7`, URL `https://beacon.builtbysai.com/cast/index.html`.
  Guest Mode and audio-only device support are off. Status: **Unpublished**.
- Set `CAST_APP_ID=E850DDA7` in the existing restricted production environment
  file and recreated only the backend, using the running deployment's actual
  Compose configuration. The running container confirmed the new ID.
- Deployed release marker remained
  `33c4848ab5beba642e605a83be66dab81ddd1270`. After activation, `/health`,
  `/ready`, and `/cast/index.html` returned 200; signed-out `/api/cast-config`
  returned 401. No code release or migration was performed.
- Pending: owner supplies the Cast device serial; register that device, wait for
  Ready for Testing, restart it, and complete signed-in/physical acceptance.
  Registration and backend health do not prove receiver WebRTC compatibility.

## Cost and current status

Google charges a **one-time, non-refundable US$5 developer-account registration
fee**. This is separate from Google Play registration. The cited documentation
does not specify a recurring Cast registration fee; Beacon hosting, TURN traffic,
internet service, and Cast hardware still have their own costs.
See [Google's fee policy](https://support.google.com/cast-developer/answer/4512496?hl=en).

The Default Media Receiver requires no registration, but Beacon implements a
**Custom Receiver** that opens its existing WebRTC guest viewer. The default
receiver is not a replacement for this implementation. See
[Google's receiver registration guide](https://developers.google.com/cast/docs/registration).

The sender and receiver code are present. The October 9 handoff reports the
receiver deployed, but physical Chromecast compatibility remains unproven. Cast
stays hidden until `CAST_APP_ID` is configured. The native Android and Electron
apps do not implement Cast senders; start testing in desktop Google Chrome.

## 1. Register the developer account

1. Open the [Google Cast SDK Developer Console](https://cast.google.com/publish/).
2. Verify the Google account. Google recommends a shared organizational account
   for organizations; the developer-account email cannot be changed later.
3. Review Google's API and Cast SDK terms, accept them if appropriate, pay the
   US$5 registration fee, and complete the account details.

Computer use can handle ordinary navigation and receiver form entry. Signing in,
MFA, terms acceptance, payment, and any CAPTCHA may need owner participation or
confirmation. At this review the connected Chrome account reached the signup
screen. The owner subsequently completed signup/payment, and the receiver was
registered as recorded above. No terms or payment were submitted by the agent.

## 2. Create the Custom Receiver

From **Applications**, choose **Add New Application**, then **Custom Receiver**.

| Field                                  | Beacon value                                    |
| -------------------------------------- | ----------------------------------------------- |
| Name                                   | Beacon SecureView                               |
| Receiver URL                           | `https://beacon.builtbysai.com/cast/index.html` |
| Supports relay casting                 | Leave off for initial same-network testing      |
| Supports casting to audio-only devices | Leave off; this receiver is video-only          |

Save the application and record its **application ID**. Beacon validates exactly
eight hexadecimal characters. Copy the ID Google issued, not a sample ID or an
OAuth client ID. The Cast application ID is configuration, not an authentication
secret. Keep the receiver unpublished during initial testing.

The public receiver page is a launcher, not public access to camera media. Its
message handler only accepts a same-origin `/g/<token>?cast=1` path. The sender
creates a four-hour, view-only guest link for one camera. No Listen, Talk,
recording, lens switching, or privacy controls are granted to the TV.

## 3. Register a test Chromecast or Cast-enabled TV

1. Connect the TV/Cast device and Chrome computer to the same local network.
   Avoid guest Wi-Fi or client isolation that prevents device discovery.
2. In the console choose **Devices → Add New Device**.
3. Enter the Cast device serial number and a friendly description. Android TV
   needs its software **Cast serial number**, which can differ from its hardware
   serial. Google's registration guide explains how casting the console page
   displays the serial number.
4. Wait at least 15 minutes and confirm **Ready for Testing**.
5. Power-cycle the Cast device as instructed by Google.

These steps follow [Google's device registration instructions](https://developers.google.com/cast/docs/registration#register-devices).
The owner supplies the hardware serial and performs physical setup/restart.

## 4. Configure Beacon on the production host

This is a production operation for the authorized operator, not part of account
registration. No database migration, OAuth client, Firebase setting, or sender
rebuild is required for the application ID.

1. Edit `/etc/beacon/production.env` on Oracle using the existing secure operator
   workflow. Set `CAST_APP_ID` to the issued ID. Preserve the file's restricted
   permissions and other settings; never copy its contents into git or chat.
2. Read `/opt/beacon/DEPLOYED_RELEASE` and use that installed release's Compose
   file. The handoff's deployed SHA is `33c4848ab5beba642e605a83be66dab81ddd1270`;
   verify the marker rather than assuming that SHA is still current.
3. Recreate only the backend with the existing deployment's project name,
   environment files, and Compose overrides. A plain `docker compose restart`
   does **not** load changed container environment variables.

Illustrative Bash command, run on Oracle after checking the active deployment
configuration. Preserve any additional overrides used by the running stack:

```bash
release_sha=$(sudo cat /opt/beacon/DEPLOYED_RELEASE)
release_dir="/opt/beacon/releases/web-${release_sha}"
sudo docker compose \
  --project-name beacon-secureview-cloud \
  --env-file /etc/beacon/production.env \
  --env-file /etc/beacon/backup.env \
  --file "$release_dir/infrastructure/cloud/compose.yaml" \
  --file "$release_dir/infrastructure/cloud/compose.notifications.yaml" \
  up -d --no-deps --no-build --force-recreate backend
```

The notifications override preserves the read-only FCM credential mount. Match
the actual deployed configuration before running the example. Recreating the
backend briefly interrupts signaling and realtime sessions; avoid active viewing
or recording. Do not print the resolved Compose configuration, which includes
secrets. Verify `/health` and `/ready` afterward. Rollback means restoring the
previous `CAST_APP_ID` value (or clearing it) and recreating the backend again.

In signed-in Chrome, visit `/api/cast-config` on Beacon's origin: it should return
`{"appId":"<issued ID>"}`. Signed-out requests must still return 401. Refresh the
viewer and open a camera as its household owner/admin. The Cast button should
appear once Google's sender framework loads.

## 5. Prove it works on real hardware

1. Choose an online camera, click Cast, and select the registered TV.
2. Confirm the TV shows moving video with no listening, talking, or management
   controls. Verify the camera device retains its visible capture indicator.
3. Confirm Household sharing lists the one-camera **Cast to TV** guest link.
4. Stop casting and verify the link is revoked and TV viewing ends. Repeat with
   navigation away, TV session termination, and explicit guest-link revocation.
5. Test privacy pause, an offline camera, a busy camera, and network recovery.
   Confirm no additional camera becomes accessible. Test both Android and browser
   camera sources, and direct/forced-TURN media where equipment permits.
6. Record device model/firmware, Chrome version, deployed SHA, network, observed
   results and limitations in `docs/testing-plan.md`. Exercise four-hour expiry
   separately; source code and fake-framework tests are not physical evidence.

Receiver WebRTC/codec support, cookies in its iframe, autoplay, and guest-session
teardown need real-device evidence. Registration alone cannot prove these work.
The existing media path is camera-to-viewer WebRTC, direct or TURN-relayed;
the backend performs authorization/signaling. Do not infer a new server video
pipeline or an end-to-end-encryption guarantee from Cast registration.

If the button is absent, check role, application ID response, Chrome rather than
Electron, and whether Google's sender SDK loaded. If the TV is absent, check
network discovery and its registered-device status. If launch fails, check the
receiver URL and ID, registration propagation, device restart, and HTTPS/asset
availability. If the page launches but video fails, investigate the guest viewer,
WebRTC and receiver compatibility; do not loosen authorization or TLS controls.

## 6. Publish only after acceptance

An unpublished receiver runs on registered development devices. Publishing makes
it launchable on all supported Cast devices; it does not bypass Beacon camera
authorization. Complete Google's requested sender/listing details (web sender:
`https://beacon.builtbysai.com`), category, availability, description and icon,
then preview and publish when the owner approves release. Do not list native
Android/iOS senders that have not been built. Google's publication fields and
process are described in its registration guide linked above.

Related: [ADR 0097](decisions/0097-cast-to-tv.md),
[October 9 review and pending work](project-review-2026-10-09.md),
[Claude handoff](handoff-2026-10-09.md).
