package com.beaconsecureview.camera

enum class StreamingState {
    Waiting,
    Connecting,
    Streaming,
    Disconnected,
    Failed,
    PermissionRequired,
}

fun stateAfterPeerConnection(connected: Boolean): StreamingState =
    if (connected) StreamingState.Streaming else StreamingState.Disconnected
