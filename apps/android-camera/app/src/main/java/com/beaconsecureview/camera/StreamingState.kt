package com.beaconsecureview.camera

enum class DeviceLifecycle {
    Pairing,
    Registering,
    Offline,
    Online,
    Streaming,
    Idle,
    Disabled,
    Revoked,
    Deleted,
    AuthenticationRequired,
    Reconnecting,
    Updating,
    Error,
}

enum class CameraSourceLifecycle {
    Registered,
    Available,
    Unavailable,
    Enabled,
    Disabled,
    Idle,
    Streaming,
    Switching,
    PermissionRequired,
    Removed,
    Error,
}

enum class ViewerLifecycle {
    Disconnected,
    Watching,
    Paused,
    Background,
    Recording,
}

enum class PairingLifecycle {
    Pending,
    Waiting,
    Accepted,
    Completed,
    Expired,
    Cancelled,
}

enum class StreamingState {
    Ready,
    Connecting,
    Connected,
    Reconnecting,
    Offline,
    Failed,
    PermissionRequired,
}

data class CameraRuntimeState(
    val device: DeviceLifecycle = DeviceLifecycle.Offline,
    val activeViewers: Int = 0,
    val retryAttempt: Int = 0,
    val cameraEnabled: Boolean = false,
    val diagnostic: String = "Camera service stopped",
    val cameras: List<RegisteredCameraSource> = emptyList(),
    val selectedCameraId: String? = null,
    val sourceLifecycle: CameraSourceLifecycle = CameraSourceLifecycle.Registered,
    val batteryOptimizationRestricted: Boolean = false,
    val pairingRequired: Boolean = false,
    val privacyMode: Boolean = false,
    val privacyChangePending: Boolean = false,
    val privacySyncPending: Boolean = false,
    val recordingActive: Boolean = false,
)

data class RegisteredCameraSource(
    val id: String,
    val sourceKey: String,
    val name: String,
    val facing: String,
)

fun deviceStateFor(
    signalingOnline: Boolean,
    activeViewers: Int,
    enabled: Boolean,
): DeviceLifecycle =
    when {
        !enabled -> DeviceLifecycle.Disabled
        !signalingOnline -> DeviceLifecycle.Offline
        activeViewers > 0 -> DeviceLifecycle.Streaming
        else -> DeviceLifecycle.Idle
    }

fun stateAfterPeerConnection(connected: Boolean): StreamingState =
    if (connected) StreamingState.Connected else StreamingState.Reconnecting

fun viewerStatusText(state: StreamingState, reconnectAttempt: Int): String =
    when (state) {
        StreamingState.Connected -> "● Live"
        StreamingState.Connecting ->
            if (reconnectAttempt > 0) "Reconnecting…" else "Connecting…"
        StreamingState.Reconnecting -> "Connection interrupted. Reconnecting…"
        StreamingState.Offline -> "Camera offline. Beacon will reconnect automatically."
        StreamingState.Failed -> "Unable to connect. Beacon will keep trying."
        StreamingState.PermissionRequired -> "Camera permission is required on the camera device."
        StreamingState.Ready -> "Ready"
    }

fun canSwitchCameraSource(
    selectedCameraId: String?,
    requestedCameraId: String,
    sourceLifecycle: CameraSourceLifecycle,
    privacyMode: Boolean,
): Boolean =
    !privacyMode &&
        sourceLifecycle != CameraSourceLifecycle.Switching &&
        requestedCameraId != selectedCameraId

internal fun shouldShowLocalPreview(privacyMode: Boolean, previewAvailable: Boolean): Boolean =
    !privacyMode && previewAvailable
