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
    fun favoritesFilterWithoutChangingSavedCameraOrder() {
        val kitchen = BeaconApi.MonitorCamera("kitchen", "Kitchen", "Pixel", true, false, 0)
        val garage = BeaconApi.MonitorCamera("garage", "Garage", "Tablet", true, false, 0)
        val cameras = listOf(kitchen, garage)

        assertEquals(
            listOf("kitchen", "garage"),
            monitorVisibleCameras(cameras, setOf("garage"), favoritesOnly = false).map { it.id },
        )
        assertEquals(
            listOf("garage"),
            monitorVisibleCameras(cameras, setOf("garage"), favoritesOnly = true).map { it.id },
        )
        assertEquals(2, cameras.size)
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
    fun cameraOrderingMovesOnlyWithinAvailableBounds() {
        val original = listOf("kitchen", "garage", "yard")
        assertEquals(listOf("garage", "kitchen", "yard"), movedCameraId(original, "garage", -1))
        assertEquals(listOf("kitchen", "yard", "garage"), movedCameraId(original, "garage", 1))
        assertEquals(
            listOf("kitchen", "garage"),
            movedCameraId(listOf("kitchen", "garage"), "kitchen", -1),
        )
    }

    @Test
    fun viewerStatusExplainsAutomaticRecovery() {
        assertEquals(
            "Camera offline. Beacon will reconnect automatically.",
            viewerStatusText(StreamingState.Offline, reconnectAttempt = 2),
        )
        assertEquals(
            "Connection interrupted. Reconnecting…",
            viewerStatusText(StreamingState.Reconnecting, reconnectAttempt = 1),
        )
    }

    @Test
    fun cameraRuntimeLabelPrioritizesPrivacyAndActiveViewing() {
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
    fun monitorHomeCopyHighlightsEmptyHealthyAndAttentionStates() {
        assertEquals("Set up your first camera", homeHeadline(emptyList()))
        assertEquals(
            "Pair a spare Android phone or tablet to begin.",
            homeSupportingText(emptyList()),
        )

        val healthy = listOf(BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", true, false, 0))
        assertEquals("Your home is within reach", homeHeadline(healthy))
        assertEquals("Every camera is ready when you need it.", homeSupportingText(healthy))

        val privacy = listOf(BeaconApi.MonitorCamera("one", "Kitchen", "Pixel", true, true, 0))
        assertEquals("A camera needs your attention", homeHeadline(privacy))
        assertEquals("Review what needs attention.", homeSupportingText(privacy))
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
