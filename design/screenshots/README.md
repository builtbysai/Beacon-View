# Beacon View screenshots

UI reviews of Beacon View captured during development: the web app (responsive audits, settings, add-device,
camera mode, dashboard) and the Android app on emulators. Organised by platform, screen and date.

- File names are `YYYY-MM-DD-HHMM-name[-first|-last]`. Times are UTC. `-first` and `-last` are the earliest and latest
  capture of the same screen, so a fix shows as a before and an after.
- These were recovered from the development session after the loose files were deleted, so they are the size the capture tool
  returned (phone captures are scaled to at most 900 px wide). Anything newer keeps its original resolution.
- Step-by-step phone and emulator test captures (picture-in-picture, push alerts, release-build checks, two-emulator camera
  setup) are test evidence rather than design reviews and are kept out of the repository, in
  `C:\Dev\Archives\screenshots-recovered-2026-10-13`, together with every recovered image and the index that maps them.
- Beacon Remote has its own folder, with the approved mockup, in the Beacon Remote repository: `design/screenshots/`.

## android / camera-emulator-review

| File                                                                                          | When                 | Size     | Context                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| [2026-10-12-1256-c-paused.png](android/camera-emulator-review/2026-10-12-1256-c-paused.png)   | 2026-10-12 12:56 UTC | 900x2000 | The Motion panel and the source rows are fixed. Now the camera's paused state on the other emulator |
| [2026-10-12-1259-c-paused2.png](android/camera-emulator-review/2026-10-12-1259-c-paused2.png) | 2026-10-12 12:59 UTC | 900x2000 | Tests, lint and the build pass. Installing on both emulators to check the camera screens            |

## android / first-android-review

| File                                                                                                                    | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0637-and-launch-first.png](android/first-android-review/2026-10-12-0637-and-launch-first.png)               | 2026-10-12 06:37 UTC | 900x2000 | A local test account exists (local dev only). Booting the emulator and building the debug app                  |
| [2026-10-12-0638-and-fresh.png](android/first-android-review/2026-10-12-0638-and-fresh.png)                             | 2026-10-12 06:38 UTC | 900x2000 | nch looks wrong, though it may be left over from an old install. I'll clear the app data and relaunch to check |
| [2026-10-12-0638-and-launch-last.png](android/first-android-review/2026-10-12-0638-and-launch-last.png)                 | 2026-10-12 06:38 UTC | 900x2000 | The emulator's System UI is still busy after booting. I'll tell it to wait and give it time                    |
| [2026-10-12-0639-and-signin-filled-first.png](android/first-android-review/2026-10-12-0639-and-signin-filled-first.png) | 2026-10-12 06:39 UTC | 900x2000 | nch looks wrong, though it may be left over from an old install. I'll clear the app data and relaunch to check |
| [2026-10-12-0639-and-signin-filled-last.png](android/first-android-review/2026-10-12-0639-and-signin-filled-last.png)   | 2026-10-12 06:39 UTC | 900x2000 | The email field lost characters. That's `adb` typing flakiness, not the app. Retyping it                       |
| [2026-10-12-0640-and-add1.png](android/first-android-review/2026-10-12-0640-and-add1.png)                               | 2026-10-12 06:40 UTC | 900x2000 | Now the new Add a device flow on Android                                                                       |
| [2026-10-12-0640-and-add3-first.png](android/first-android-review/2026-10-12-0640-and-add3-first.png)                   | 2026-10-12 06:40 UTC | 900x2000 | Now the new Add a device flow on Android                                                                       |
| [2026-10-12-0640-and-add3-last.png](android/first-android-review/2026-10-12-0640-and-add3-last.png)                     | 2026-10-12 06:40 UTC | 900x2000 | Now the new Add a device flow on Android                                                                       |
| [2026-10-12-0640-and-home.png](android/first-android-review/2026-10-12-0640-and-home.png)                               | 2026-10-12 06:40 UTC | 900x2000 | The email field lost characters. That's `adb` typing flakiness, not the app. Retyping it                       |
| [2026-10-12-0641-and-menu.png](android/first-android-review/2026-10-12-0641-and-menu.png)                               | 2026-10-12 06:41 UTC | 900x2000 | I'm fixing small Android layout issues and reviewing the remaining screens. Opening the menu and Settings next |
| [2026-10-12-0641-and-set3-first.png](android/first-android-review/2026-10-12-0641-and-set3-first.png)                   | 2026-10-12 06:41 UTC | 900x2000 | I'm fixing small Android layout issues and reviewing the remaining screens. Opening the menu and Settings next |
| [2026-10-12-0641-and-set3-last.png](android/first-android-review/2026-10-12-0641-and-set3-last.png)                     | 2026-10-12 06:41 UTC | 900x2000 | I'm fixing small Android layout issues and reviewing the remaining screens. Opening the menu and Settings next |
| [2026-10-12-0643-and-activity-first.png](android/first-android-review/2026-10-12-0643-and-activity-first.png)           | 2026-10-12 06:43 UTC | 900x2000 | Now the low-contrast labels on the welcome card                                                                |
| [2026-10-12-0643-and-activity-last.png](android/first-android-review/2026-10-12-0643-and-activity-last.png)             | 2026-10-12 06:43 UTC | 900x2000 | Now the low-contrast labels on the welcome card                                                                |
| [2026-10-12-0646-and-set4-first.png](android/first-android-review/2026-10-12-0646-and-set4-first.png)                   | 2026-10-12 06:46 UTC | 900x2000 | It builds and the unit tests pass. Reinstalling to check the fixes on the emulator                             |
| [2026-10-12-0646-and-set4-last.png](android/first-android-review/2026-10-12-0646-and-set4-last.png)                     | 2026-10-12 06:46 UTC | 900x2000 | It builds and the unit tests pass. Reinstalling to check the fixes on the emulator                             |
| [2026-10-12-0647-and-cam1.jpg](android/first-android-review/2026-10-12-0647-and-cam1.jpg)                               | 2026-10-12 06:47 UTC | 900x2000 | Those layout fixes worked. Now "This device" to see the camera setup                                           |
| [2026-10-12-0647-and-this1.png](android/first-android-review/2026-10-12-0647-and-this1.png)                             | 2026-10-12 06:47 UTC | 900x2000 | That was the Settings page, which has no Add device button. Going via Home instead                             |
| [2026-10-12-0647-and-this2.png](android/first-android-review/2026-10-12-0647-and-this2.png)                             | 2026-10-12 06:47 UTC | 900x2000 | Those layout fixes worked. Now "This device" to see the camera setup                                           |
| [2026-10-12-0649-and-cam3-first.jpg](android/first-android-review/2026-10-12-0649-and-cam3-first.jpg)                   | 2026-10-12 06:49 UTC | 900x2000 | a screen works, but the top-left status indicator is just a tiny dark circle with no label. Checking that code |
| [2026-10-12-0649-and-cam3-last.jpg](android/first-android-review/2026-10-12-0649-and-cam3-last.jpg)                     | 2026-10-12 06:49 UTC | 900x2000 | a screen works, but the top-left status indicator is just a tiny dark circle with no label. Checking that code |
| [2026-10-12-0700-and-cam5.jpg](android/first-android-review/2026-10-12-0700-and-cam5.jpg)                               | 2026-10-12 07:00 UTC | 900x2000 | The build is still running in the background. Waiting for it                                                   |
| [2026-10-12-0715-and-cam6.jpg](android/first-android-review/2026-10-12-0715-and-cam6.jpg)                               | 2026-10-12 07:15 UTC | 900x2000 | Build, tests and lint pass. Installing it and checking the status chip                                         |

## android / monitor-emulator-review

| File                                                                                                   | When                 | Size     | Context                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-1226-m-start-first.png](android/monitor-emulator-review/2026-10-12-1226-m-start-first.png) | 2026-10-12 12:26 UTC | 840x1800 | stays the paired camera and a second emulator acts as the monitor. Starting the local stack and both emulators |
| [2026-10-12-1227-m-signin.png](android/monitor-emulator-review/2026-10-12-1227-m-signin.png)           | 2026-10-12 12:27 UTC | 840x1800 | lator hit the same System UI hang, and its screen is a different size (840×1800). Tapping Wait and relaunching |
| [2026-10-12-1227-m-start-last.png](android/monitor-emulator-review/2026-10-12-1227-m-start-last.png)   | 2026-10-12 12:27 UTC | 840x1800 | lator hit the same System UI hang, and its screen is a different size (840×1800). Tapping Wait and relaunching |
| [2026-10-12-1228-m-home-first.png](android/monitor-emulator-review/2026-10-12-1228-m-home-first.png)   | 2026-10-12 12:28 UTC | 840x1800 | lator hit the same System UI hang, and its screen is a different size (840×1800). Tapping Wait and relaunching |
| [2026-10-12-1229-m-signin2.png](android/monitor-emulator-review/2026-10-12-1229-m-signin2.png)         | 2026-10-12 12:29 UTC | 840x1800 | The email field got junk typed into it. Clearing it and retyping step by step                                  |
| [2026-10-12-1229-m-signin3.png](android/monitor-emulator-review/2026-10-12-1229-m-signin3.png)         | 2026-10-12 12:29 UTC | 840x1800 | The email field got junk typed into it. Clearing it and retyping step by step                                  |
| [2026-10-12-1231-m-home-last.png](android/monitor-emulator-review/2026-10-12-1231-m-home-last.png)     | 2026-10-12 12:31 UTC | 840x1800 | Both fields are filled. Tapping Sign in                                                                        |
| [2026-10-12-1231-m-home2.png](android/monitor-emulator-review/2026-10-12-1231-m-home2.png)             | 2026-10-12 12:31 UTC | 840x1800 | Both fields are filled. Tapping Sign in                                                                        |
| [2026-10-12-1232-m-live1.jpg](android/monitor-emulator-review/2026-10-12-1232-m-live1.jpg)             | 2026-10-12 12:32 UTC | 840x1800 | home screen looks right at this narrower width. Opening the live view, which is the screen I haven't seen yet  |
| [2026-10-12-1232-m-live2.png](android/monitor-emulator-review/2026-10-12-1232-m-live2.png)             | 2026-10-12 12:32 UTC | 840x1800 | home screen looks right at this narrower width. Opening the live view, which is the screen I haven't seen yet  |
| [2026-10-12-1233-m-live4.jpg](android/monitor-emulator-review/2026-10-12-1233-m-live4.jpg)             | 2026-10-12 12:33 UTC | 840x1800 | While that builds, I'll look at the live view's More sheet on the running build                                |
| [2026-10-12-1249-m-now.png](android/monitor-emulator-review/2026-10-12-1249-m-now.png)                 | 2026-10-12 12:49 UTC | 840x1800 | d (it fell back to compiling without the Kotlin daemon, which was slow). Installing it on the monitor emulator |
| [2026-10-12-1250-m-dev2-first.png](android/monitor-emulator-review/2026-10-12-1250-m-dev2-first.png)   | 2026-10-12 12:50 UTC | 840x1800 | The More sheet is clear. Now the camera settings page behind the gear                                          |
| [2026-10-12-1250-m-dev2-last.png](android/monitor-emulator-review/2026-10-12-1250-m-dev2-last.png)     | 2026-10-12 12:50 UTC | 840x1800 | The More sheet is clear. Now the camera settings page behind the gear                                          |
| [2026-10-12-1250-m-live5.jpg](android/monitor-emulator-review/2026-10-12-1250-m-live5.jpg)             | 2026-10-12 12:50 UTC | 840x1800 | d (it fell back to compiling without the Kotlin daemon, which was slow). Installing it on the monitor emulator |
| [2026-10-12-1250-m-more.png](android/monitor-emulator-review/2026-10-12-1250-m-more.png)               | 2026-10-12 12:50 UTC | 840x1800 | The header now holds together with a long name. Next the More sheet                                            |
| [2026-10-12-1251-m-dev4-first.png](android/monitor-emulator-review/2026-10-12-1251-m-dev4-first.png)   | 2026-10-12 12:51 UTC | 840x1800 | While that builds, I'll look further down this device page on the running app                                  |
| [2026-10-12-1251-m-dev4-last.png](android/monitor-emulator-review/2026-10-12-1251-m-dev4-last.png)     | 2026-10-12 12:51 UTC | 840x1800 | While that builds, I'll look further down this device page on the running app                                  |
| [2026-10-12-1253-m-dev7.png](android/monitor-emulator-review/2026-10-12-1253-m-dev7.png)               | 2026-10-12 12:53 UTC | 840x1800 | The build is running. I'll install and re-check the Motion panel and the source rows when it finishes          |
| [2026-10-12-1254-m-cams.png](android/monitor-emulator-review/2026-10-12-1254-m-cams.png)               | 2026-10-12 12:54 UTC | 840x1800 | ifted with the smaller body text, so my taps hit the wrong thing. Going back to Home to find the right buttons |
| [2026-10-12-1254-m-home3.png](android/monitor-emulator-review/2026-10-12-1254-m-home3.png)             | 2026-10-12 12:54 UTC | 840x1800 | ifted with the smaller body text, so my taps hit the wrong thing. Going back to Home to find the right buttons |
| [2026-10-12-1255-m-cardmenu.png](android/monitor-emulator-review/2026-10-12-1255-m-cardmenu.png)       | 2026-10-12 12:55 UTC | 840x1800 | ifted with the smaller body text, so my taps hit the wrong thing. Going back to Home to find the right buttons |
| [2026-10-12-1255-m-dev8-first.png](android/monitor-emulator-review/2026-10-12-1255-m-dev8-first.png)   | 2026-10-12 12:55 UTC | 840x1800 | ifted with the smaller body text, so my taps hit the wrong thing. Going back to Home to find the right buttons |
| [2026-10-12-1255-m-dev8-last.png](android/monitor-emulator-review/2026-10-12-1255-m-dev8-last.png)     | 2026-10-12 12:55 UTC | 840x1800 | ifted with the smaller body text, so my taps hit the wrong thing. Going back to Home to find the right buttons |
| [2026-10-12-1300-m-menu.png](android/monitor-emulator-review/2026-10-12-1300-m-menu.png)               | 2026-10-12 13:00 UTC | 840x1800 | #129. In the meantime I'll look at the remaining Android screens, Activity and Clips, on the monitor emulator  |
| [2026-10-12-1301-m-home5.png](android/monitor-emulator-review/2026-10-12-1301-m-home5.png)             | 2026-10-12 13:01 UTC | 840x1800 | you yet" for the household owner, which is wrong. It may just be loading after the restart, so I'll look again |

## android / slimmed-app-check

| File                                                                                     | When                 | Size     | Context                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-1432-y-2-first.jpg](android/slimmed-app-check/2026-10-12-1432-y-2-first.jpg) | 2026-10-12 14:32 UTC | 840x1800 | erything passes (tests, lint, build). Installing the slimmed app on both emulators to verify the real behavior |
| [2026-10-12-1432-y-2-last.jpg](android/slimmed-app-check/2026-10-12-1432-y-2-last.jpg)   | 2026-10-12 14:32 UTC | 900x2000 | erything passes (tests, lint, build). Installing the slimmed app on both emulators to verify the real behavior |
| [2026-10-12-1433-y-3.jpg](android/slimmed-app-check/2026-10-12-1433-y-3.jpg)             | 2026-10-12 14:33 UTC | 900x2000 | Both paired phones open straight to the native camera screen. Testing the gear menu's "Open Beacon" entry      |
| [2026-10-12-1433-y-4.jpg](android/slimmed-app-check/2026-10-12-1433-y-4.jpg)             | 2026-10-12 14:33 UTC | 840x1800 | Both paired phones open straight to the native camera screen. Testing the gear menu's "Open Beacon" entry      |
| [2026-10-12-1434-y-5.png](android/slimmed-app-check/2026-10-12-1434-y-5.png)             | 2026-10-12 14:34 UTC | 840x1800 | s "Open Beacon". Tapping it, then checking that the web app's "This phone" section reflects the running camera |

## android / status-bar-live-snapshot

| File                                                                                | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-1501-z-1.png](android/status-bar-live-snapshot/2026-10-12-1501-z-1.png) | 2026-10-12 15:01 UTC | 840x1800 | e clean. Installing the latest build and testing the status bar, live view and a snapshot save on the emulator |

## android / webview-bridge-camera-setup

| File                                                                                   | When                 | Size     | Context                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-1404-x-1.png](android/webview-bridge-camera-setup/2026-10-12-1404-x-1.png) | 2026-10-12 14:04 UTC | 840x1800 | While those run, I'm building the debug app with the bridge so I can test the real flow on the emulators       |
| [2026-10-12-1404-x-2.png](android/webview-bridge-camera-setup/2026-10-12-1404-x-2.png) | 2026-10-12 14:04 UTC | 840x1800 | The launcher now routes straight into the web app. Waiting for the dev server to finish loading                |
| [2026-10-12-1405-x-3.png](android/webview-bridge-camera-setup/2026-10-12-1405-x-3.png) | 2026-10-12 14:05 UTC | 840x1800 | rsisted and the dashboard shows. Opening the new "This phone" settings section by deep link to test the bridge |
| [2026-10-12-1405-x-4.png](android/webview-bridge-camera-setup/2026-10-12-1405-x-4.png) | 2026-10-12 14:05 UTC | 840x1800 | he phone's camera state from the native side. Now the full flow: set up this phone as a camera from the web UI |
| [2026-10-12-1406-x-5.png](android/webview-bridge-camera-setup/2026-10-12-1406-x-5.png) | 2026-10-12 14:06 UTC | 840x1800 | he phone's camera state from the native side. Now the full flow: set up this phone as a camera from the web UI |
| [2026-10-12-1406-x-6.png](android/webview-bridge-camera-setup/2026-10-12-1406-x-6.png) | 2026-10-12 14:06 UTC | 840x1800 | he phone's camera state from the native side. Now the full flow: set up this phone as a camera from the web UI |
| [2026-10-12-1406-x-7.png](android/webview-bridge-camera-setup/2026-10-12-1406-x-7.png) | 2026-10-12 14:06 UTC | 840x1800 | The app-specific wording shows. Starting the camera from the web UI                                            |
| [2026-10-12-1406-x-8.png](android/webview-bridge-camera-setup/2026-10-12-1406-x-8.png) | 2026-10-12 14:06 UTC | 840x1800 | button paired the phone natively and opened the camera screen, which is now asking for permission. Granting it |
| [2026-10-12-1407-x-9.jpg](android/webview-bridge-camera-setup/2026-10-12-1407-x-9.jpg) | 2026-10-12 14:07 UTC | 840x1800 | button paired the phone natively and opened the camera screen, which is now asking for permission. Granting it |

## android / webview-shell

| File                                                                                 | When                 | Size     | Context                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-1311-w-1-first.jpg](android/webview-shell/2026-10-12-1311-w-1-first.jpg) | 2026-10-12 13:11 UTC | 840x1800 | cy tests pass and the debug build succeeds. Installing and launching the WebView shell on the monitor emulator |
| [2026-10-12-1313-w-1-last.png](android/webview-shell/2026-10-12-1313-w-1-last.png)   | 2026-10-12 13:13 UTC | 840x1800 | The build failed in 7 seconds, so the old APK was installed. Checking the error                                |
| [2026-10-12-1313-w-2.png](android/webview-shell/2026-10-12-1313-w-2.png)             | 2026-10-12 13:13 UTC | 840x1800 | The page is blank. Checking the WebView's console and network logs                                             |
| [2026-10-12-1314-w-3.png](android/webview-shell/2026-10-12-1314-w-3.png)             | 2026-10-12 13:14 UTC | 840x1800 | pp itself is loading (its own splash). The Vite dev server is slow over the emulator, so I'll give it a moment |
| [2026-10-12-1314-w-5.png](android/webview-shell/2026-10-12-1314-w-5.png)             | 2026-10-12 13:14 UTC | 840x1800 | signed out, it shows the marketing landing page, which the app should skip later. Trying the sign-in flow now  |
| [2026-10-12-1314-w-6.png](android/webview-shell/2026-10-12-1314-w-6.png)             | 2026-10-12 13:14 UTC | 840x1800 | signed out, it shows the marketing landing page, which the app should skip later. Trying the sign-in flow now  |
| [2026-10-12-1315-w-7.png](android/webview-shell/2026-10-12-1315-w-7.png)             | 2026-10-12 13:15 UTC | 840x1800 | The web sign-in screen is showing, exactly as in the browser. Signing in with the test account                 |
| [2026-10-12-1315-w-8.jpg](android/webview-shell/2026-10-12-1315-w-8.jpg)             | 2026-10-12 13:15 UTC | 840x1800 | The dashboard is the web app, identical to the browser. Now the critical test: live video through the WebView  |

## web / activity

| File                                                                                | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-activity-1280.png](web/activity/2026-10-12-0613-activity-1280.png) | 2026-10-12 06:13 UTC | 1280x800 | /events`, not `/activity`, so the capture was showing Home. I'm fixing the script and adding more states to it |
| [2026-10-12-0614-activity-390.png](web/activity/2026-10-12-0614-activity-390.png)   | 2026-10-12 06:14 UTC | 390x844  | Reset filters lands alone on a second grid row with no styling. I'll make it a quiet text button, left-aligned |

## web / add-camera

| File                                                                                      | When                 | Size     | Context                                                                                |
| ----------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| [2026-10-12-0532-add-camera-1280.png](web/add-camera/2026-10-12-0532-add-camera-1280.png) | 2026-10-12 05:32 UTC | 1280x900 | Rewriting the settings page structure with grouped sections and a shared section frame |

## web / add-device-computer

| File                                                                                                                             | When                 | Size     | Context                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0533-add-device-computer-1280-first.png](web/add-device-computer/2026-10-12-0533-add-device-computer-1280-first.png) | 2026-10-12 05:33 UTC | 1280x900 | Rewriting the settings page structure with grouped sections and a shared section frame                         |
| [2026-10-12-0614-add-device-computer-1280-last.png](web/add-device-computer/2026-10-12-0614-add-device-computer-1280-last.png)   | 2026-10-12 06:14 UTC | 1280x800 | Reviewing more screens: Add device (computer, iPhone), the landing page, diagnostics and the Camera Mode setup |

## web / add-device-ios

| File                                                                                                | When                 | Size    | Context                                                                                                        |
| --------------------------------------------------------------------------------------------------- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0614-add-device-ios-390.png](web/add-device-ios/2026-10-12-0614-add-device-ios-390.png) | 2026-10-12 06:14 UTC | 390x844 | Reviewing more screens: Add device (computer, iPhone), the landing page, diagnostics and the Camera Mode setup |

## web / add-device-mobile

| File                                                                                                                     | When                 | Size     | Context                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| [2026-10-12-0532-add-device-mobile-1280.png](web/add-device-mobile/2026-10-12-0532-add-device-mobile-1280.png)           | 2026-10-12 05:32 UTC | 1280x900 | Rewriting the settings page structure with grouped sections and a shared section frame |
| [2026-10-12-0538-add-device-mobile-390-first.png](web/add-device-mobile/2026-10-12-0538-add-device-mobile-390-first.png) | 2026-10-12 05:38 UTC | 390x1500 | Rewriting the settings page structure with grouped sections and a shared section frame |
| [2026-10-12-0538-add-device-mobile-390-last.png](web/add-device-mobile/2026-10-12-0538-add-device-mobile-390-last.png)   | 2026-10-12 05:38 UTC | 390x1500 | Rewriting the settings page structure with grouped sections and a shared section frame |

## web / add-device-this

| File                                                                                                   | When                 | Size    | Context                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| [2026-10-12-0613-add-device-this-390.png](web/add-device-this/2026-10-12-0613-add-device-this-390.png) | 2026-10-12 06:13 UTC | 390x844 | Camera Mode is committed. Next is the screen-by-screen review, starting with a fresh capture of every screen |

## web / camera-mode

| File                                                                                         | When                 | Size     | Context                                                                                |
| -------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| [2026-10-12-0525-camera-mode-1280.png](web/camera-mode/2026-10-12-0525-camera-mode-1280.png) | 2026-10-12 05:25 UTC | 1280x800 | Rewriting the settings page structure with grouped sections and a shared section frame |

## web / cameras

| File                                                                           | When                 | Size    | Context                                                                                                      |
| ------------------------------------------------------------------------------ | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| [2026-10-12-0613-cameras-390.png](web/cameras/2026-10-12-0613-cameras-390.png) | 2026-10-12 06:13 UTC | 390x844 | Camera Mode is committed. Next is the screen-by-screen review, starting with a fresh capture of every screen |

## web / cameras-camera-0

| File                                                                                                      | When                 | Size    | Context                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-10-2300-cameras-camera-0-320.png](web/cameras-camera-0/2026-10-10-2300-cameras-camera-0-320.png) | 2026-10-10 23:00 UTC | 320x740 | e screen at 320px, which I already fixed. It also sits behind the "Connecting" overlay, so I'm fixing that now |

## web / cm-live-desktop

| File                                                                                                       | When                 | Size     | Context                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0606-cm-live-desktop-first.png](web/cm-live-desktop/2026-10-12-0606-cm-live-desktop-first.png) | 2026-10-12 06:06 UTC | 1280x800 | Now the Camera Mode screen: capturing it to see why its settings are hard to see on the black background |
| [2026-10-12-0607-cm-live-desktop-last.png](web/cm-live-desktop/2026-10-12-0607-cm-live-desktop-last.png)   | 2026-10-12 06:07 UTC | 1280x800 | Now the Camera Mode screen: capturing it to see why its settings are hard to see on the black background |

## web / cm-settings-desktop

| File                                                                                                                   | When                 | Size     | Context                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0610-cm-settings-desktop-first.png](web/cm-settings-desktop/2026-10-12-0610-cm-settings-desktop-first.png) | 2026-10-12 06:10 UTC | 1280x800 | screenshot on mobile is badly broken, though: dark text on dark and a collapsed layout. I'll look at that next |
| [2026-10-12-0611-cm-settings-desktop-last.png](web/cm-settings-desktop/2026-10-12-0611-cm-settings-desktop-last.png)   | 2026-10-12 06:11 UTC | 1280x800 | Now close the wrapper, then restyle the CSS                                                                    |

## web / cm-settings-mobile

| File                                                                                                                | When                 | Size     | Context                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0610-cm-settings-mobile-first.png](web/cm-settings-mobile/2026-10-12-0610-cm-settings-mobile-first.png) | 2026-10-12 06:10 UTC | 1280x800 | Now re-capture to verify                                                                                      |
| [2026-10-12-0611-cm-settings-mobile-last.png](web/cm-settings-mobile/2026-10-12-0611-cm-settings-mobile-last.png)   | 2026-10-12 06:11 UTC | 390x844  | are still invisible, the select is white, and the mobile panel is bottom-aligned. Finding what overrides them |

## web / cm-setup-mobile

| File                                                                                           | When                 | Size    | Context                                                                                                        |
| ---------------------------------------------------------------------------------------------- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0614-cm-setup-mobile.png](web/cm-setup-mobile/2026-10-12-0614-cm-setup-mobile.png) | 2026-10-12 06:14 UTC | 390x844 | Reviewing more screens: Add device (computer, iPhone), the landing page, diagnostics and the Camera Mode setup |

## web / dashboard

| File                                                                                   | When                 | Size     | Context                                                                                                      |
| -------------------------------------------------------------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| [2026-10-12-0613-dashboard-1280.png](web/dashboard/2026-10-12-0613-dashboard-1280.png) | 2026-10-12 06:13 UTC | 1280x800 | Camera Mode is committed. Next is the screen-by-screen review, starting with a fresh capture of every screen |

## web / diagnostics

| File                                                                                         | When                 | Size     | Context                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0614-diagnostics-1280.png](web/diagnostics/2026-10-12-0614-diagnostics-1280.png) | 2026-10-12 06:14 UTC | 1280x800 | Reviewing more screens: Add device (computer, iPhone), the landing page, diagnostics and the Camera Mode setup |

## web / download-section

| File                                                                                                        | When                 | Size     | Context                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| [2026-10-12-0544-download-section-1280.png](web/download-section/2026-10-12-0544-download-section-1280.png) | 2026-10-12 05:44 UTC | 1265x855 | Building the shared app-downloads component: a pure options module, the component, styles, and tests |

## web / guest

| File                                                                     | When                 | Size    | Context                                                                                                        |
| ------------------------------------------------------------------------ | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-guest-390.png](web/guest/2026-10-12-0613-guest-390.png) | 2026-10-12 06:13 UTC | 390x844 | I is running on the PR. Meanwhile I'll start the guest and shared page review, checking what those pages fetch |

## web / join

| File                                                                    | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-join-1280.png](web/join/2026-10-12-0613-join-1280.png) | 2026-10-12 06:13 UTC | 1280x800 | I is running on the PR. Meanwhile I'll start the guest and shared page review, checking what those pages fetch |

## web / landing

| File                                                                                         | When                 | Size     | Context                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------- |
| [2026-10-12-0542-landing-1280-first.png](web/landing/2026-10-12-0542-landing-1280-first.png) | 2026-10-12 05:42 UTC | 582x2000 | Rewriting the Android add-device page to use the same three-way vocabulary as the web |
| [2026-10-12-0542-landing-1280-last.png](web/landing/2026-10-12-0542-landing-1280-last.png)   | 2026-10-12 05:42 UTC | 780x2000 | Rewriting the Android add-device page to use the same three-way vocabulary as the web |

## web / live-more

| File                                                                                             | When                 | Size     | Context                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-10-2259-live-more-390-first.png](web/live-more/2026-10-10-2259-live-more-390-first.png) | 2026-10-10 22:59 UTC | 390x844  | ll mangled the template literals (as the handoff notes warned), so I'll fix those two lines with the Edit tool |
| [2026-10-10-2300-live-more-1280.png](web/live-more/2026-10-10-2300-live-more-1280.png)           | 2026-10-10 23:00 UTC | 1280x800 | e screen at 320px, which I already fixed. It also sits behind the "Connecting" overlay, so I'm fixing that now |
| [2026-10-10-2300-live-more-390-last.png](web/live-more/2026-10-10-2300-live-more-390-last.png)   | 2026-10-10 23:00 UTC | 390x844  | e screen at 320px, which I already fixed. It also sits behind the "Connecting" overlay, so I'm fixing that now |
| [2026-10-10-2302-live-more-768.png](web/live-more/2026-10-10-2302-live-more-768.png)             | 2026-10-10 23:02 UTC | 768x1024 | e screen at 320px, which I already fixed. It also sits behind the "Connecting" overlay, so I'm fixing that now |

## web / misc

| File                                                            | When                 | Size     | Context                                                                                                        |
| --------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-11-0045-emu1.png](web/misc/2026-10-11-0045-emu1.png)   | 2026-10-11 00:45 UTC | 900x2000 | try the emulator: run the built backend image locally, seed an account and a camera, and sign in from the app  |
| [2026-10-11-0046-emu2.png](web/misc/2026-10-11-0046-emu2.png)   | 2026-10-11 00:46 UTC | 900x2000 | try the emulator: run the built backend image locally, seed an account and a camera, and sign in from the app  |
| [2026-10-11-0047-emu3.png](web/misc/2026-10-11-0047-emu3.png)   | 2026-10-11 00:47 UTC | 900x2000 | Quick update: the app is running in the emulator and I'm signing in with the seeded account                    |
| [2026-10-11-0049-emu4.png](web/misc/2026-10-11-0049-emu4.png)   | 2026-10-11 00:49 UTC | 900x2000 | Quick update: the app is running in the emulator and I'm signing in with the seeded account                    |
| [2026-10-11-0049-emu5.png](web/misc/2026-10-11-0049-emu5.png)   | 2026-10-11 00:49 UTC | 900x2000 | Quick update: the app is running in the emulator and I'm signing in with the seeded account                    |
| [2026-10-11-0049-emu6.png](web/misc/2026-10-11-0049-emu6.png)   | 2026-10-11 00:49 UTC | 900x2000 | Quick update: the app is running in the emulator and I'm signing in with the seeded account                    |
| [2026-10-11-0050-emu7.png](web/misc/2026-10-11-0050-emu7.png)   | 2026-10-11 00:50 UTC | 900x2000 | pping the tile does nothing for an offline camera, so I'll try the "Review" link (V86 says it opens live view) |
| [2026-10-11-0051-emu10.png](web/misc/2026-10-11-0051-emu10.png) | 2026-10-11 00:51 UTC | 900x2000 | The Android bar now shows the four controls: Audio, Talk, Record and More. I'll open More                      |
| [2026-10-11-0051-emu8.png](web/misc/2026-10-11-0051-emu8.png)   | 2026-10-11 00:51 UTC | 900x2000 | ile the camera is offline. I'll hold a fake camera connection open from a script so the camera shows as online |
| [2026-10-11-0051-emu9.png](web/misc/2026-10-11-0051-emu9.png)   | 2026-10-11 00:51 UTC | 900x2000 | ile the camera is offline. I'll hold a fake camera connection open from a script so the camera shows as online |

## web / pair

| File                                                                    | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-pair-390.png](web/pair/2026-10-12-0613-pair-390.png)   | 2026-10-12 06:13 UTC | 390x844  | I is running on the PR. Meanwhile I'll start the guest and shared page review, checking what those pages fetch |
| [2026-10-12-0614-pair-1280.png](web/pair/2026-10-12-0614-pair-1280.png) | 2026-10-12 06:14 UTC | 1280x800 | Much better. Checking dark mode and PR #126's CI                                                               |

## web / settings

| File                                                                                            | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0518-settings-1280-first.png](web/settings/2026-10-12-0518-settings-1280-first.png) | 2026-10-12 05:18 UTC | 1280x800 | Adding the Android banner as its own file, then wiring it above the page switch                                |
| [2026-10-12-0613-settings-390.png](web/settings/2026-10-12-0613-settings-390.png)               | 2026-10-12 06:13 UTC | 390x844  | /events`, not `/activity`, so the capture was showing Home. I'm fixing the script and adding more states to it |
| [2026-10-12-0618-settings-1280-last.png](web/settings/2026-10-12-0618-settings-1280-last.png)   | 2026-10-12 06:18 UTC | 1280x800 | Now the landing page, settings and dark mode                                                                   |

## web / settings-notifications

| File                                                                                                                                      | When                 | Size      | Context                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- | -------------------------------------------------------------------------------------- |
| [2026-10-12-0521-settings-notifications-1280-first.png](web/settings-notifications/2026-10-12-0521-settings-notifications-1280-first.png) | 2026-10-12 05:21 UTC | 1280x1700 | Rewriting the settings page structure with grouped sections and a shared section frame |
| [2026-10-12-0521-settings-notifications-1280-last.png](web/settings-notifications/2026-10-12-0521-settings-notifications-1280-last.png)   | 2026-10-12 05:21 UTC | 1280x1100 | Rewriting the settings page structure with grouped sections and a shared section frame |
| [2026-10-12-0521-settings-notifications-390.png](web/settings-notifications/2026-10-12-0521-settings-notifications-390.png)               | 2026-10-12 05:21 UTC | 390x2000  | Rewriting the settings page structure with grouped sections and a shared section frame |

## web / shared

| File                                                                                      | When                 | Size     | Context                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-shared-390.png](web/shared/2026-10-12-0613-shared-390.png)               | 2026-10-12 06:13 UTC | 390x844  | I is running on the PR. Meanwhile I'll start the guest and shared page review, checking what those pages fetch |
| [2026-10-12-0614-shared-1280-first.png](web/shared/2026-10-12-0614-shared-1280-first.png) | 2026-10-12 06:14 UTC | 390x844  | hese utility pages were lost in an earlier CSS consolidation. I'll rebuild them with the current design tokens |
| [2026-10-12-0614-shared-1280-last.png](web/shared/2026-10-12-0614-shared-1280-last.png)   | 2026-10-12 06:14 UTC | 1280x800 | hese utility pages were lost in an earlier CSS consolidation. I'll rebuild them with the current design tokens |

## web / trust

| File                                                                       | When                 | Size     | Context                                                                                                        |
| -------------------------------------------------------------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-trust-1280.png](web/trust/2026-10-12-0613-trust-1280.png) | 2026-10-12 06:13 UTC | 1280x800 | /events`, not `/activity`, so the capture was showing Home. I'm fixing the script and adding more states to it |

## web / wall

| File                                                                              | When                 | Size    | Context                                                                                                        |
| --------------------------------------------------------------------------------- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| [2026-10-12-0613-wall-390-first.png](web/wall/2026-10-12-0613-wall-390-first.png) | 2026-10-12 06:13 UTC | 390x844 | /events`, not `/activity`, so the capture was showing Home. I'm fixing the script and adding more states to it |
| [2026-10-12-0614-wall-390-last.png](web/wall/2026-10-12-0614-wall-390-last.png)   | 2026-10-12 06:14 UTC | 390x844 | Fixed. Now the wall tile overlay that covers camera names                                                      |
