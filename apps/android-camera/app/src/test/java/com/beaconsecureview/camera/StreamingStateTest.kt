package com.beaconsecureview.camera

import android.content.pm.ServiceInfo
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StreamingStateTest {
    @Test
    fun cameraCaptureRunsOnlyForAPairedPhoneThatMayCaptureAndNotify() {
        assertTrue(shouldRunCameraCapture(paired = true, cameraAllowed = true, notificationsAllowed = true))
        assertFalse(shouldRunCameraCapture(paired = false, cameraAllowed = true, notificationsAllowed = true))
        assertFalse(shouldRunCameraCapture(paired = true, cameraAllowed = false, notificationsAllowed = true))
        assertFalse(shouldRunCameraCapture(paired = true, cameraAllowed = true, notificationsAllowed = false))
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

}
