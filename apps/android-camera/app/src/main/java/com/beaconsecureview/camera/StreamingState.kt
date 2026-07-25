package com.beaconsecureview.camera

enum class DeviceLifecycle {
    Offline,
    Online,
    Streaming,
    Idle,
    Updating,
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
        !enabled -> DeviceLifecycle.Offline
        !signalingOnline -> DeviceLifecycle.Offline
        activeViewers > 0 -> DeviceLifecycle.Streaming
        else -> DeviceLifecycle.Idle
    }

fun stateAfterPeerConnection(connected: Boolean): StreamingState =
    if (connected) StreamingState.Connected else StreamingState.Reconnecting
