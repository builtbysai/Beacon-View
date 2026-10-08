package com.beaconsecureview.camera

import android.content.pm.ServiceInfo
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StreamingStateTest {
    @Test
    fun firstRunShowsWelcomeBeforeCameraPairing() {
        assertTrue(
            shouldShowWelcome(
                paired = false,
                monitorMode = false,
                cameraSetupStarted = false,
            ),
        )
        assertFalse(
            shouldShowWelcome(
                paired = false,
                monitorMode = false,
                cameraSetupStarted = true,
            ),
        )
        assertFalse(
            shouldShowWelcome(
                paired = false,
                monitorMode = true,
                cameraSetupStarted = false,
            ),
        )
    }

    @Test
    fun monitorDestinationNeverRunsCameraCapture() {
        assertFalse(
            shouldRunCameraCapture(
                monitorMode = true,
                paired = true,
                cameraAllowed = true,
                notificationsAllowed = true,
            ),
        )
        assertTrue(
            shouldRunCameraCapture(
                monitorMode = false,
                paired = true,
                cameraAllowed = true,
                notificationsAllowed = true,
            ),
        )
    }

    @Test
    fun cameraPermissionGuidancePrioritizesCaptureBlockers() {
        assertEquals(
            CameraPermissionPrompt.Camera,
            cameraPermissionPrompt(
                cameraAllowed = false,
                notificationsAllowed = false,
                microphoneAllowed = false,
            ),
        )
        assertEquals(
            CameraPermissionPrompt.Notification,
            cameraPermissionPrompt(
                cameraAllowed = true,
                notificationsAllowed = false,
                microphoneAllowed = false,
            ),
        )
        assertEquals(
            CameraPermissionPrompt.Microphone,
            cameraPermissionPrompt(
                cameraAllowed = true,
                notificationsAllowed = true,
                microphoneAllowed = false,
            ),
        )
        assertEquals(
            null,
            cameraPermissionPrompt(
                cameraAllowed = true,
                notificationsAllowed = true,
                microphoneAllowed = true,
            ),
        )
    }

    @Test
    fun connectedPeerIsStreaming() {
        assertEquals(StreamingState.Connected, stateAfterPeerConnection(connected = true))
    }

    @Test
    fun disconnectedPeerIsNotStreaming() {
        assertEquals(StreamingState.Reconnecting, stateAfterPeerConnection(connected = false))
    }

    @Test
    fun cameraLifecycleIsIndependentFromViewerLifecycle() {
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Streaming,
            deviceStateFor(signalingOnline = true, activeViewers = 3, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
    }

    @Test
    fun networkLossDoesNotRequirePairingAgain() {
        assertEquals(
            DeviceLifecycle.Offline,
            deviceStateFor(signalingOnline = false, activeViewers = 0, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
    }

    @Test
    fun disabledDeviceHasAnExplicitLifecycle() {
        assertEquals(
            DeviceLifecycle.Disabled,
            deviceStateFor(signalingOnline = true, activeViewers = 2, enabled = false),
        )
    }

    @Test
    fun sourceSwitchingIsDistinctFromFailure() {
        val runtime = CameraRuntimeState(sourceLifecycle = CameraSourceLifecycle.Switching)
        assertEquals(CameraSourceLifecycle.Switching, runtime.sourceLifecycle)
    }

    @Test
    fun nativeViewerRunsOnlyWhileItsScreenIsStarted() {
        assertEquals(true, shouldRunNativeViewer(lifecycleStarted = true))
        assertEquals(false, shouldRunNativeViewer(lifecycleStarted = false))
    }

    @Test
    fun monitorGridAdaptsToTheCurrentWindowWidth() {
        assertEquals(1, monitorColumnCount(widthDp = 599f))
        assertEquals(2, monitorColumnCount(widthDp = 600f))
        assertEquals(2, monitorColumnCount(widthDp = 839f))
        assertEquals(3, monitorColumnCount(widthDp = 840f))
    }

    @Test
    fun liveViewerCountExcludesThisSession() {
        assertEquals(0, otherViewerCount(viewerCount = 0, connected = true))
        assertEquals(0, otherViewerCount(viewerCount = 1, connected = true))
        assertEquals(2, otherViewerCount(viewerCount = 3, connected = true))
        assertEquals(2, otherViewerCount(viewerCount = 2, connected = false))
    }

    @Test
    fun microphoneDenialKeepsVideoAvailableWithoutAudioCapture() {
        assertEquals(false, shouldCaptureAudio(microphonePermissionGranted = false))
        assertEquals(true, shouldCaptureAudio(microphonePermissionGranted = true))
    }

    @Test
    fun privacyKeepsAValidCameraForegroundServiceWithoutClaimingMicrophone() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA,
            foregroundServiceType(captureActive = false, microphoneEnabled = true),
        )
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            foregroundServiceType(captureActive = true, microphoneEnabled = true),
        )
    }

    @Test
    fun localPreviewAttachesWhileCaptureStartsButNeverDuringPrivacy() {
        assertEquals(true, shouldShowLocalPreview(privacyMode = false, previewAvailable = true))
        assertEquals(false, shouldShowLocalPreview(privacyMode = true, previewAvailable = true))
        assertEquals(false, shouldShowLocalPreview(privacyMode = false, previewAvailable = false))
    }

    @Test
    fun favoriteToggleAddsAndRemovesOnlyTheSelectedCamera() {
        assertEquals(setOf("garage", "kitchen"), toggledFavoriteIds(setOf("garage"), "kitchen"))
        assertEquals(setOf("garage"), toggledFavoriteIds(setOf("garage", "kitchen"), "kitchen"))
    }

    @Test
    fun monitorHealthUsesOnlyReportedCameraState() {
        val cameras =
            listOf(
                BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", true, false, 2),
                BeaconApi.MonitorCamera("two", "Garage", "Tablet", false, false, 0),
                BeaconApi.MonitorCamera("three", "Yard", "Phone", true, true, 0),
            )
        assertEquals(
            MonitorHealth(cameras = 3, online = 2, offline = 1, live = 1, viewers = 2),
            monitorHealth(cameras),
        )
    }

    @Test
    fun savedCameraOrderPrunesRemovedCamerasAndAppendsNewOnes() {
        assertEquals(
            listOf("garage", "kitchen", "yard"),
            normalizedCameraOrder(
                savedIds = listOf("removed", "garage", "garage", "kitchen"),
                availableIds = listOf("kitchen", "garage", "yard"),
            ),
        )
    }

    @Test
    fun cameraCatalogFilterMatchesReadyPrivacyAndAttentionExclusively() {
        val ready = BeaconApi.MonitorCamera("ready", "Kitchen", "Pixel", true, false, 0)
        val privacy = BeaconApi.MonitorCamera("privacy", "Garage", "Tablet", true, true, 0)
        val offline = BeaconApi.MonitorCamera("offline", "Yard", "Phone", false, false, 0)
        val cameras = listOf(ready, privacy, offline)

        assertEquals(
            listOf("ready", "privacy", "offline"),
            cameraCatalogVisible(cameras, CameraCatalogFilter.All, "").map { it.id },
        )
        assertEquals(listOf("ready"), cameraCatalogVisible(cameras, CameraCatalogFilter.Ready, "").map { it.id })
        assertEquals(listOf("privacy"), cameraCatalogVisible(cameras, CameraCatalogFilter.Privacy, "").map { it.id })
        assertEquals(listOf("offline"), cameraCatalogVisible(cameras, CameraCatalogFilter.Attention, "").map { it.id })
    }

    @Test
    fun cameraCatalogSearchMatchesNameOrDeviceNameCaseInsensitively() {
        val kitchen = BeaconApi.MonitorCamera("kitchen", "Front door", "Kitchen Pixel", true, false, 0)
        val garage = BeaconApi.MonitorCamera("garage", "Driveway", "Garage Tablet", true, false, 0)
        val cameras = listOf(kitchen, garage)

        assertEquals(
            listOf("kitchen"),
            cameraCatalogVisible(cameras, CameraCatalogFilter.All, "kitchen").map { it.id },
        )
        assertEquals(
            listOf("garage"),
            cameraCatalogVisible(cameras, CameraCatalogFilter.All, "DRIVEWAY").map { it.id },
        )
        assertEquals(2, cameras.size)
    }

    @Test
    fun liveOverlayPrioritizesPrivacyOverConnectionState() {
        assertEquals(
            LiveOverlay(
                "Privacy is on",
                "Live viewing is blocked. Turn privacy off when you are ready to resume.",
            ),
            liveOverlay(StreamingState.Connected, privacyMode = true, reconnectAttempt = 0),
        )
    }

    @Test
    fun liveOverlayIsNullOnlyWhenConnectedOrReadyWithoutPrivacy() {
        assertEquals(null, liveOverlay(StreamingState.Connected, privacyMode = false, reconnectAttempt = 0))
        assertEquals(null, liveOverlay(StreamingState.Ready, privacyMode = false, reconnectAttempt = 0))
    }

    @Test
    fun liveOverlayReportsReconnectAttemptOnlyWhenNonZero() {
        assertEquals(
            LiveOverlay("Connection interrupted", "Beacon is retrying."),
            liveOverlay(StreamingState.Reconnecting, privacyMode = false, reconnectAttempt = 0),
        )
        assertEquals(
            LiveOverlay("Connection interrupted", "Beacon is retrying · attempt 3."),
            liveOverlay(StreamingState.Reconnecting, privacyMode = false, reconnectAttempt = 3),
        )
    }

    @Test
    fun cameraCatalogResultsMessageReportsSearchMatchOrPlainCount() {
        assertEquals("2 of 3 cameras shown", cameraCatalogResultsMessage("", 2, 3))
        assertEquals(
            "1 camera matches “kitchen”.",
            cameraCatalogResultsMessage("kitchen", 1, 3),
        )
        assertEquals(
            "2 cameras match “cam”.",
            cameraCatalogResultsMessage("cam", 2, 3),
        )
    }

    @Test
    fun cameraRuntimeLabelPrioritizesPrivacyRecordingAndActiveViewing() {
        assertEquals(
            "PRIVACY ON",
            cameraRuntimeLabel(
                CameraRuntimeState(
                    device = DeviceLifecycle.Streaming,
                    activeViewers = 2,
                    privacyMode = true,
                ),
            ),
        )
        assertEquals(
            "RECORDING",
            cameraRuntimeLabel(
                CameraRuntimeState(
                    device = DeviceLifecycle.Streaming,
                    activeViewers = 1,
                    recordingActive = true,
                ),
            ),
        )
        assertEquals(
            "LIVE",
            cameraRuntimeLabel(
                CameraRuntimeState(device = DeviceLifecycle.Streaming, activeViewers = 2),
            ),
        )
        assertEquals(
            "ONLINE",
            cameraRuntimeLabel(CameraRuntimeState(device = DeviceLifecycle.Idle)),
        )
        assertEquals(
            "RECONNECTING",
            cameraRuntimeLabel(CameraRuntimeState(device = DeviceLifecycle.Reconnecting)),
        )
    }

    @Test
    fun homeGreetingMatchesTimeOfDay() {
        assertEquals("Good morning", homeGreeting(hour = 8))
        assertEquals("Good afternoon", homeGreeting(hour = 14))
        assertEquals("Good evening", homeGreeting(hour = 20))
        assertEquals("Good evening", homeGreeting(hour = 2))
    }

    @Test
    fun homeSubtitleReportsReadyCountAndPrivacyOnlyWhenNothingNeedsAttention() {
        val allReady = listOf(
            BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", true, false, 0),
            BeaconApi.MonitorCamera("two", "Yard", "Pixel", true, false, 0),
        )
        assertEquals("2 of 2 cameras are ready to view.", homeSubtitle(allReady))

        val onePrivacy = listOf(
            BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", true, false, 0),
            BeaconApi.MonitorCamera("two", "Yard", "Pixel", true, true, 0),
        )
        assertEquals("1 of 2 cameras are ready to view. 1 has privacy on.", homeSubtitle(onePrivacy))

        // Attention (offline, non-privacy) cameras take precedence over mentioning privacy mode.
        val offlineAndPrivacy = listOf(
            BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", false, false, 0),
            BeaconApi.MonitorCamera("two", "Yard", "Pixel", true, true, 0),
        )
        assertEquals("0 of 2 cameras are ready to view.", homeSubtitle(offlineAndPrivacy))
    }

    @Test
    fun homeAttentionCamerasExcludesPrivacyModeAndOnlineCameras() {
        val cameras = listOf(
            BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", false, false, 0),
            BeaconApi.MonitorCamera("two", "Yard", "Pixel", true, true, 0),
            BeaconApi.MonitorCamera("three", "Garage", "Pixel", true, false, 0),
        )
        val attention = homeAttentionCameras(cameras)
        assertEquals(listOf("Kitchen"), attention.map { it.name })
        assertEquals("Pixel needs attention", homeAttentionTitle(attention))
        assertEquals("Camera is offline. Reconnect it to restore live viewing.", homeAttentionDescription(attention))
    }

    @Test
    fun homeFavoriteCamerasFallsBackToFirstFourWhenNoneChosen() {
        val cameras = (1..5).map { BeaconApi.MonitorCamera("id$it", "Cam $it", "Pixel", true, false, 0) }
        assertEquals(listOf("id1", "id2", "id3", "id4"), homeFavoriteCameras(cameras, emptySet()).map { it.id })
        assertEquals(listOf("id5"), homeFavoriteCameras(cameras, setOf("id5")).map { it.id })
    }

    @Test
    fun sourceSwitchRejectsDuplicatesAndConcurrentTransitions() {
        assertEquals(
            true,
            canSwitchCameraSource("rear", "front", CameraSourceLifecycle.Available, privacyMode = false),
        )
        assertEquals(
            false,
            canSwitchCameraSource("rear", "rear", CameraSourceLifecycle.Available, privacyMode = false),
        )
        assertEquals(
            false,
            canSwitchCameraSource("rear", "front", CameraSourceLifecycle.Switching, privacyMode = false),
        )
        assertEquals(
            false,
            canSwitchCameraSource("rear", "front", CameraSourceLifecycle.Disabled, privacyMode = true),
        )
    }

    @Test
    fun monitorShowsOneActiveSourcePerPhysicalDevice() {
        val rear =
            BeaconApi.MonitorCamera(
                "rear",
                "Rear camera",
                "Hallway phone",
                true,
                false,
                0,
                deviceId = "phone",
                facing = "rear",
                available = false,
            )
        val front =
            rear.copy(id = "front", name = "Front camera", facing = "front", available = true)
        val laptop =
            rear.copy(id = "laptop", name = "Webcam", deviceName = "Office laptop", deviceId = "computer", available = true)

        assertEquals(listOf("front", "laptop"), monitorHostCameras(listOf(rear, front, laptop)).map { it.id })
    }

    @Test
    fun viewerFlipCyclesEverySourceOnTheSameDevice() {
        val rear =
            BeaconApi.MonitorCamera(
                "rear",
                "Rear camera",
                "Hallway phone",
                true,
                false,
                0,
                deviceId = "phone",
            )
        val front = rear.copy(id = "front", name = "Front camera")
        val external = rear.copy(id = "external", name = "USB camera")
        val otherDevice = rear.copy(id = "office", deviceId = "laptop")
        val cameras = listOf(rear, otherDevice, front, external)

        assertEquals("front", nextCameraSource(cameras, rear)?.id)
        assertEquals("external", nextCameraSource(cameras, front)?.id)
        assertEquals("rear", nextCameraSource(cameras, external)?.id)
        assertEquals(null, nextCameraSource(cameras, otherDevice))
    }

    @Test
    fun liveViewerFollowsTheNewlyActiveSourceAfterACameraSideFlip() {
        val rear =
            BeaconApi.MonitorCamera(
                "rear",
                "Rear camera",
                "Hallway phone",
                true,
                false,
                1,
                deviceId = "phone",
                available = true,
            )
        val front = rear.copy(id = "front", name = "Front camera", available = false)
        val refreshed = listOf(rear.copy(available = false), front.copy(available = true))

        assertEquals(
            "front",
            reconciledCameraId(listOf(rear, front), refreshed, selectedCameraId = "rear"),
        )
    }

    @Test
    fun accessHistoryTimestampIsReadableWithoutLeakingProtocolDetails() {
        assertEquals(
            "Sep 10, 2026 · 12:34 PM",
            friendlyAccessTime("2026-09-10T12:34:56.000Z", ZoneId.of("UTC")),
        )
    }

    @Test
    fun accessHistoryNormalizesNullableApiFieldsAndHumanizesActors() {
        assertEquals(null, nullableApiText("null"))
        assertEquals(null, nullableApiText("  "))
        assertEquals("Camera device", accessEventTarget("null", null))
        assertEquals("Android Camera", accessEventTarget(null, "Android Camera"))
        assertEquals("On camera device", accessEventActor("privacy_enabled", "null", "owner@example.com"))
        assertEquals(null, accessEventActor("live_view_started", null, "owner@example.com"))
        assertEquals("By you", accessEventActor("live_view_started", "OWNER@example.com", "owner@example.com"))
    }

    @Test
    fun accessHistoryPresentsPrivacyDeletionAndRejectionEvents() {
        assertEquals("VIEWED", accessEventStatus("live_view_started"))
        assertEquals("PAUSED", accessEventStatus("privacy_enabled"))
        assertEquals("RESUMED", accessEventStatus("privacy_disabled"))
        assertEquals("REVOKED", accessEventStatus("device_credential_revoked"))
        assertEquals("Privacy mode enabled", accessEventLabel("privacy_enabled"))
        assertEquals("Camera deleted", accessEventLabel("camera_source_deleted"))
        assertEquals("Access rejected", accessEventLabel("live_view_rejected"))
        assertEquals("Capture stopped", accessEventDetail("privacy_enabled", null))
        assertEquals("Camera offline", accessEventDetail("live_view_rejected", "camera_offline"))
    }
}
