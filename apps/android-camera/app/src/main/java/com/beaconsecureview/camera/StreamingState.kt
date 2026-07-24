package com.beaconsecureview.camera

enum class StreamingState {
    Ready,
    Connecting,
    Connected,
    Reconnecting,
    Offline,
    Failed,
    PermissionRequired,
}

fun stateAfterPeerConnection(connected: Boolean): StreamingState =
    if (connected) StreamingState.Connected else StreamingState.Reconnecting
