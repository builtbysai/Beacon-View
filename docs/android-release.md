# Releasing the Android app to Google Play

Written October 10, 2026 for audit findings F7 and V24. The build changes are in
`apps/android-camera/app/build.gradle.kts`. Everything marked **Owner** needs the
Play Console or a private key, so it cannot be done from the repository.

## What the build now does

- `versionCode` and `versionName` come from Gradle properties
  (`-PbeaconVersionCode`, `-PbeaconVersionName`), defaulting to `1` and `0.0.0`.
  Play refuses an upload whose `versionCode` it has already seen, so raise it for
  every upload.
- The release build is signed when these environment variables are set, and
  unsigned otherwise (the previous behaviour):
  `BEACON_UPLOAD_KEYSTORE` (path), `BEACON_UPLOAD_KEYSTORE_PASSWORD`,
  `BEACON_UPLOAD_KEY_ALIAS`, `BEACON_UPLOAD_KEY_PASSWORD`. Nothing about the key
  is stored in the repository, and none of it may be.
- Code shrinking (R8) is **still off**. Turning it on without a device pass risks a
  launch crash in WebRTC, MediaPipe or the JSON parsing, so it needs its own change
  with keep rules and a real-device test of live view, talk and clips. The release
  APK is large (about 117 MB unsigned) because of that and because MediaPipe ships
  even though smart detection is off (V62); build an AAB so Play delivers a
  per-device split.

## Owner steps, in order

1. **Create the upload key** and keep it outside the repository, backed up in a
   password manager. Losing it is recoverable through Play, but slow.

   ```bash
   keytool -genkeypair -v -keystore beacon-upload.jks -alias beacon-upload \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. **Create the app** in the Play Console with the package name
   `com.beaconsecureview.camera` and accept **Play App Signing**. Google then holds
   the key that signs what users install; your upload key only proves uploads are yours.
3. **Build the bundle** with the production address:

   ```powershell
   $env:BEACON_UPLOAD_KEYSTORE = 'C:\keys\beacon-upload.jks'
   $env:BEACON_UPLOAD_KEYSTORE_PASSWORD = '...'
   $env:BEACON_UPLOAD_KEY_ALIAS = 'beacon-upload'
   $env:BEACON_UPLOAD_KEY_PASSWORD = '...'
   $env:BEACON_RELEASE_API_URL = 'https://beacon.builtbysai.com'
   apps/android-camera/gradlew.bat -p apps/android-camera :app:bundleRelease `
     -PbeaconVersionCode=2 -PbeaconVersionName=0.1.0
   ```

   The bundle is `app/build/outputs/bundle/release/app-release.aab`.

4. **Add the Play signing certificate to App Links.** Play Console, App integrity,
   shows the SHA-256 of the key Google signs with. Add it as a second fingerprint in
   `apps/web-viewer/public/.well-known/assetlinks.json`, which today lists only the
   private-alpha debug key (ADR 0034), and deploy the web build. Until then the
   `https://beacon.builtbysai.com/pair` and `/auth/mobile` links open in the browser
   instead of the Play-installed app. Android verifies this with `autoVerify`.
5. **Start with internal testing**, then closed testing. Check in the Play Console
   help whether your account type requires a minimum number of testers for a number
   of days before production access; new personal accounts have had such a rule.
6. **Complete the declarations**, which reviewers read closely for a camera app:
   - Data safety: the app sends video and audio only to the owner's own household
     (live view) and uploads clips to the owner's Google Drive. Account email,
     device identifiers and push tokens go to Beacon's server. Do not claim
     end-to-end encryption: the server unwraps recording keys (audit V6).
   - Foreground service types `camera` and `microphone`
     (`FOREGROUND_SERVICE_CAMERA`, `FOREGROUND_SERVICE_MICROPHONE`): Play asks for a
     description and a short video showing the persistent notification and the
     camera-in-use state. The app already shows a notification while capturing.
   - `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is restricted. A camera that must keep
     running is a listed use, but it needs justification; remove the permission if
     you would rather avoid the review (the app then relies on the user changing the
     setting by hand).
   - Privacy policy URL (use the Trust page or a dedicated page), content rating,
     target audience (adults), and the account-deletion URL. In-app deletion
     exists; Play also wants a web URL.
7. **Cast to TV** is a web and desktop feature (ADR 0097): the receiver is
   registered as application `E850DDA7` and needs no Play step.

## Still open after this change

- Run the release build on a real device: sign-in, pairing, live view, talk, a motion
  clip, push, and the App Link.
- Toolchain age and dependency scanning (V24): compile and target SDK are 35, and
  there is no Gradle dependency-vulnerability check in CI yet.
- R8 and a per-ABI bundle (V62).
